// codex: one call through the Codex CLI (`codex exec`), signed in with its own login (`codex login`). Non-interactive
// and ephemeral (no session files); the user's config.toml and rules skipped; a read-only sandbox in a folder kept
// empty for the purpose, with Codex's command, browsing and image tools turned off, so the model can only answer; the
// git check skipped; its events (--json) are read for the idea log (usage, tool calls, each item's times). The prompt
// goes on stdin, the static guide first and the idea last, so its long prefix is the same on every call (a separate
// `codex exec` reports no cache hits, so every call pays for it whole: keep it lean); the final message is written to
// a file and constrained by --output-schema to the generated look's schema, made strict. The answer is untrusted
// data, read as the claude adapter reads its own, then cleaned by validateLook; its code only ever runs in the sandbox
// or the render box.
// The library docs reach the model through one MCP tool, read_doc (docs-mcp.ts), over the tree written once per
// library under the work folder; with the shell off, they are all it can read.

import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

import { GenerateError } from '../../shared/schemas/generated.ts';
import type { Logger } from '../http.ts';
import { monoNow } from '../clock.ts';
import { type Config, configOf } from '../config.ts';
import { parseJson, pickLook } from './claude.ts';
import { docsBlock } from './docs-turn.ts';
import type { Availability, Probe } from './adapters.ts';
import type { Context } from './index.ts';
import { READ_CAP } from './doc-path.ts';
import { findExecutable, Interrupted, runCommand, STOP_SIGNALS } from './proc.ts';
import { buildPrompt, buildRepairMessage, buildUserMessage } from './prompt.ts';

const MAX_ANSWER_BYTES = 512 * 1024;
const DOCS_SERVER = fileURLToPath(new URL('./docs-mcp.ts', import.meta.url));
// Tools a look needs none of (codex features list, 0.160.1); an unknown name is ignored with a warning.
const FEATURES_OFF = ['shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins', 'multi_agent', 'browser_use',
  'computer_use', 'image_generation'];
// A composition (not a repair, critique or draft) writes the whole look from scratch, and higher effort reasons
// longer: its wall clock is the call's, times this.
const COMPOSE_SCALE: Record<string, number> = { high: 1.5, xhigh: 2 };
// A call with no event for this long has stalled (the longest quiet stretch of a healthy one, measured: 143 s, a
// composition at high writing 6k tokens); xhigh writes longer. Its process is killed and the call tried once more.
const IDLE_SCALE: Record<string, number> = { xhigh: 2 };
// What the CLI needs from the environment (its home, login, proxy, the OS); nothing else of the server's reaches it.
const PASS_ENV = new RegExp(`^(?:${['PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE',
  'HOMEPATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'LOGNAME', 'LANG',
  'LC_\\w+', 'TZ', 'XDG_\\w+', 'CODEX_\\w+', 'OPENAI_\\w+', '(?:HTTPS?|ALL|NO)_PROXY', 'SSL_CERT_\\w+',
  'NODE_EXTRA_CA_CERTS'].join('|')})$`, 'i');
/** The schema as strict structured output takes it: every property required, the optional ones nullable. */
export function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === 'enum' || k === 'required' ? v : strictSchema(v);
  const props = out.properties as Record<string, unknown> | undefined;
  if (out.type === 'object' && props) {
    const required = new Set((out.required ?? []) as string[]);
    for (const name of Object.keys(props)) {
      if (!required.has(name)) props[name] = { anyOf: [props[name], { type: 'null' }] };
    }
    out.required = Object.keys(props);
  }
  return out;
}

/** Nulls, the strict schema's "left out", dropped from objects, so the look reads as if they were never there. */
export function dropNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, dropNulls(x)]));
}

/** Whether the Codex CLI can run here: on PATH, and (else a warning) signed in. */
export function probe({ env, codexBin }: Probe): Availability {
  if (!findExecutable(codexBin, { env })) return { available: false, note: `${codexBin} is not on PATH.` };
  const home = env.CODEX_HOME || path.join(homedir(), '.codex');
  return existsSync(path.join(home, 'auth.json')) || env.CODEX_API_KEY
    ? { available: true, note: 'Codex CLI found, signed in.' }
    : { available: true, warn: true, note: 'Codex CLI found; no login seen (run codex login).' };
}

// Options (environment): bin (STUDIO_CODEX_BIN, "codex"), model, effort, timeoutMs (STUDIO_CODEX_TIMEOUT_MS, 300000;
// a composition's scaled by effort: COMPOSE_SCALE), idleMs (STUDIO_CODEX_IDLE_MS, 180000, scaled by IDLE_SCALE),
// workDir (STUDIO_CODEX_WORK, <tmp>/folly-studio-codex), schema (STUDIO_CODEX_SCHEMA=0: no --output-schema),
// userConfig (STUDIO_CODEX_USER_CONFIG=1: read ~/.codex/config.toml after all).
type Options = Partial<{ env: NodeJS.ProcessEnv, config: Config, bin: string, model: string, effort: string,
  timeoutMs: number, idleMs: number, workDir: string, schema: boolean, userConfig: boolean, maxOutputBytes: number,
  log: Logger }>;
export function createCodexAdapter(o: Options = {}) {
  const env = o.env || process.env, c = o.config ?? configOf(env);
  const cfg = {
    bin: o.bin || c.STUDIO_CODEX_BIN || 'codex', model: o.model || 'gpt-6.1-sol', effort: o.effort || '',
    timeoutMs: o.timeoutMs ?? c.STUDIO_CODEX_TIMEOUT_MS ?? 300_000,
    idleMs: o.idleMs ?? c.STUDIO_CODEX_IDLE_MS ?? 180_000,
    workDir: path.resolve(o.workDir || c.STUDIO_CODEX_WORK || path.join(tmpdir(), 'folly-studio-codex')),
    schema: o.schema ?? c.STUDIO_CODEX_SCHEMA ?? true,
    userConfig: o.userConfig ?? c.STUDIO_CODEX_USER_CONFIG ?? false,
    maxOutputBytes: o.maxOutputBytes ?? 4 << 20, log: o.log || console,
  };
  const childEnv = Object.fromEntries(Object.entries(env).filter(([k]) => PASS_ENV.test(k)));

  /** The argument list for one call: the answer to `out`, the schema from `schemaFile` when there is one, `images`
   * attached (a flag follows them: -i takes several), the docs server over `docs` (the tree's folder) noting reads in
   * `reads`. */
  function argsFor(cwd: string, out: string, schemaFile: string | null, images: string[] = [],
    docs?: { dir: string, reads: string, given?: readonly string[] }) {
    const args = ['exec', ...images.flatMap((f) => ['-i', f]), '--json', '--ephemeral', '--skip-git-repo-check',
      '--ignore-rules', '-s', 'read-only', '-C', cwd,
      '-m', cfg.model, '-o', out, '-c', 'web_search="disabled"', ...FEATURES_OFF.flatMap((f) => ['-c',
        `features.${f}=false`])];
    if (docs) {
      args.push('-c', `mcp_servers.docs.command=${JSON.stringify(process.execPath)}`, '-c', `mcp_servers.docs.args=${
        JSON.stringify([DOCS_SERVER, docs.dir, docs.reads, String(READ_CAP), (docs.given ?? []).join(',')])}`,
      '-c', 'mcp_servers.docs.default_tools_approval_mode="approve"');
    }
    if (!cfg.userConfig) args.push('--ignore-user-config');
    if (cfg.effort) args.push('-c', `model_reasoning_effort="${cfg.effort}"`);
    // Its reasoning summary comes as `reasoning` items, which the idea log keeps (SPEC-generators "The idea log").
    args.push('-c', 'model_reasoning_summary="auto"');
    if (schemaFile) args.push('--output-schema', schemaFile);
    return [...args, '-']; // the prompt: stdin
  }

  async function generate(ctx: Context) {
    const command = findExecutable(cfg.bin, { env });
    if (!command) {
      throw new GenerateError('The AI generator is not configured on this server.', `${cfg.bin} not found on PATH`);
    }
    const built = ctx.prompt?.() ?? buildPrompt(ctx), { system } = built;
    const schema = ctx.schema ?? built.schema, docs = ctx.schema ? undefined : built.docs;
    // A repair is a fresh run (codex keeps no session here): the same prefix, then the last answer and what was wrong.
    const repair = ctx.repair ? `\nYour answer was:\n${JSON.stringify(ctx.repair.answer)}\n\n`
      + `${ctx.repair.message ?? buildRepairMessage(ctx.repair.errors)}\n` : '';
    const empty = path.join(cfg.workDir, 'empty');
    await fs.mkdir(empty, { recursive: true });
    const job = await fs.mkdtemp(path.join(cfg.workDir, 'job-'));
    const given = (ctx.docsGiven ?? []).filter((p) => built.docs?.has(p));
    const turn = `${docsBlock(built.docs ?? new Map(), given)}${ctx.turn ?? buildUserMessage(ctx.text)}\n${repair}`;
    let t0 = monoNow();
    const reads: string[] = [], lines: Line[] = [], decoder = new StringDecoder('utf8');
    let partial = '';
    /** Each whole line of its events with when it arrived (ms into the call). */
    const heard = (b: Buffer) => {
      const parts = (partial + decoder.write(b)).split('\n');
      partial = parts.pop() ?? '';
      lines.push(...parts.map((line) => ({ at: monoNow() - t0, line })));
      for (const said of parts.filter((l) => l.includes('"reasoning"')).map(reasoningOf)) {
        if (said) ctx.round?.think?.(`\n\n${said}`);
      }
    };
    const composing = !ctx.repair && !ctx.schema;
    const timeoutMs = Math.round(cfg.timeoutMs * (composing ? COMPOSE_SCALE[cfg.effort] ?? 1 : 1));
    let answer: unknown, failed = '', images: string[] = [];
    try {
      const out = path.join(job, 'answer.json');
      const schemaFile = cfg.schema ? path.join(job, 'schema.json') : null;
      if (schemaFile) await fs.writeFile(schemaFile, JSON.stringify(strictSchema(schema)));
      images = await Promise.all([...ctx.images ?? [], ...ctx.repair?.images ?? []].map(async (png, i) => {
        const file = path.join(job, `still-${i + 1}.png`);
        await fs.writeFile(file, png);
        return file;
      }));
      const tree = docs?.size ? { dir: await writeDocs(cfg.workDir, docs), reads: path.join(job, 'reads.txt'),
        given } : undefined;
      const idleMs = Math.round(cfg.idleMs * (IDLE_SCALE[cfg.effort] ?? 1));
      const run = () => runCommand({ ...command, args: [...command.args, ...argsFor(empty, out, schemaFile, images,
        tree)], input: `${system}\n\n${turn}`, cwd: empty, env: childEnv, timeoutMs, idleMs,
      maxOutputBytes: cfg.maxOutputBytes, signal: ctx.signal, stdout: heard });
      let ran = await run();
      if (ran.killed === 'idle') { // stalled: its own process is gone; the stall goes in the log, and once more
        const { usage, items } = readEvents(lines), quietFor = `no events for ${Math.round(idleMs / 1000)} s`;
        cfg.log.warn?.(`[generate] idea ${ctx.idea?.id ?? '-'}: codex stalled (${quietFor}); trying again`);
        ctx.round?.call({ ms: monoNow() - t0, system, turn, images: images.length, tools: items, usage, docs: [],
          error: `stalled: ${quietFor}; tried again` });
        [lines.length, partial, t0] = [0, '', monoNow()];
        ran = await run();
      }
      if (tree) reads.push(...(await fs.readFile(tree.reads, 'utf8').catch(() => '')).split('\n')
        .filter(Boolean).slice(0, READ_CAP));
      ctx.docsRead?.push(...reads);
      const said = [ran.tail.trim(), ...readEvents(lines).errors].join('\n').trim().split('\n').slice(-3).join(' | ')
        .slice(0, 300);
      if (ran.killed === 'timeout' || ran.killed === 'idle') {
        throw new GenerateError('The AI generator took too long; please try again.', `codex: ${ran.ms} ms, no answer`);
      }
      if (ran.killed === 'abort') throw new GenerateError('The idea was stopped before it finished.', 'codex: aborted');
      if (!ran.killed && ran.signal && STOP_SIGNALS.has(ran.signal)) {
        throw new Interrupted('The idea was stopped before it finished.', `codex: ${ran.signal}, not sent by us`);
      }
      if (ran.killed === 'output') {
        throw new GenerateError('The AI returned a look the studio could not read.', 'codex: too much output');
      }
      if (ran.code !== 0) {
        throw new GenerateError('The AI generator failed; please try again.', `codex exited ${ran.code ?? ran.signal}: `
          + said);
      }
      const parsed = dropNulls(parseJson(await readAnswer(out))), look = ctx.schema ? parsed : pickLook(parsed);
      if (!look) throw new GenerateError('The AI returned a look the studio could not read.', 'codex: not a look');
      answer = parsed;
      return look;
    } catch (err) {
      failed = String((err as Error)?.message || err);
      throw err;
    } finally {
      const { usage, items } = readEvents(lines);
      ctx.round?.call({ ms: monoNow() - t0, system, turn, images: images.length, reply: answer, tools: items, usage,
        docs: reads, ...(failed ? { error: failed } : {}) });
      await fs.rm(job, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { name: 'codex', generate, argsFor, config: cfg };
}

/** The docs tree's folder under `workDir` (`docs-<hash>`), written once per tree: into a fresh folder, then renamed,
 * so a job never reads half a tree. */
async function writeDocs(workDir: string, docs: ReadonlyMap<string, string>) {
  const hash = createHash('sha256').update(JSON.stringify([...docs])).digest('hex').slice(0, 16);
  const dir = path.join(workDir, `docs-${hash}`);
  if (await fs.stat(dir).then(() => true, () => false)) return fs.realpath(dir);
  const tmp = await fs.mkdtemp(path.join(workDir, 'docs-tmp-'));
  for (const [rel, text] of docs) {
    await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true });
    await fs.writeFile(path.join(tmp, rel), text);
  }
  await fs.rename(tmp, dir).catch(() => fs.rm(tmp, { recursive: true, force: true })); // another job wrote it first
  return fs.realpath(dir);
}

type Line = { at: number, line: string };
/** `codex exec --json`'s events (JSONL on stdout, each line with when it arrived): the turn's usage, the items it
 * completed (reasoning, tool calls, messages) for the idea log, each with `at` (ms into the call when it completed)
 * and `from` (when it started, when codex says), and any error it reported. */
export function readEvents(lines: Line[]) {
  const usage = { input: 0, cached: 0, output: 0, reasoning: 0 }, items: unknown[] = [], errors: string[] = [];
  const started = new Map<unknown, number>();
  for (const { at, line } of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === 'item.started' && ev.item) started.set(ev.item.id, at);
    else if (ev?.type === 'item.completed' && ev.item) {
      const from = started.get(ev.item.id);
      items.push({ ...ev.item, at, ...(from === undefined ? {} : { from }) });
    }
    else if (ev?.type === 'turn.completed' && ev.usage) {
      const u = ev.usage;
      usage.input += Number(u.input_tokens) || 0;
      usage.cached += Number(u.cached_input_tokens) || 0;
      usage.output += Number(u.output_tokens) || 0;
      usage.reasoning += Number(u.reasoning_output_tokens) || 0;
    } else if (ev?.type === 'error' || ev?.type === 'turn.failed') {
      errors.push(String(ev.message ?? ev.error?.message ?? '').slice(0, 300));
    }
  }
  return { usage, items, errors: errors.filter(Boolean) };
}

/** A reasoning item's text, from one line of its events ('' for any other line), for the idea's live round. */
function reasoningOf(line: string) {
  try {
    const ev = JSON.parse(line);
    return ev?.type === 'item.completed' && ev.item?.type === 'reasoning' && typeof ev.item.text === 'string'
      ? ev.item.text : '';
  } catch { return ''; }
}

/** The final message, as untrusted data: a regular file, size-capped. */
async function readAnswer(file: string) {
  const st = await fs.lstat(file).catch(() => null);
  if (!st?.isFile() || st.size === 0) throw new GenerateError('The AI generator gave no answer.', 'codex: no answer');
  if (st.size > MAX_ANSWER_BYTES) {
    throw new GenerateError('The AI returned a look the studio could not read.', `codex: ${st.size}-byte answer`);
  }
  return fs.readFile(file, 'utf8');
}
