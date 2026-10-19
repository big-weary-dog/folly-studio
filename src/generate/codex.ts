// codex: one call through the Codex CLI (`codex exec`), signed in with its own login (`codex login`). Non-interactive
// and ephemeral (no session files); the user's config.toml and rules skipped; a read-only sandbox in a folder kept
// empty for the purpose, with Codex's command, browsing and image tools turned off, so the model can only answer; the
// git check skipped. The prompt goes on stdin, the static guide first and the idea last, so its long prefix is the
// same on every call (the provider caches it); the final message is written to a file and constrained by
// --output-schema to the generated look's schema, made strict. The answer is untrusted data, read as the claude
// adapter reads its own, then cleaned by validateLook; its code only ever runs in the sandbox or the render box.

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GenerateError } from '../../shared/schemas/generated.ts';
import type { Logger } from '../http.ts';
import { parseJson, pickLook } from './claude.ts';
import type { Context } from './index.ts';
import { findExecutable, runCommand } from './proc.ts';
import { buildPrompt, buildRepairMessage, buildUserMessage } from './prompt.ts';

const MAX_ANSWER_BYTES = 512 * 1024;
// Tools a look needs none of (codex features list, 0.160.1); an unknown name is ignored with a warning.
const FEATURES_OFF = ['shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins', 'multi_agent', 'browser_use',
  'computer_use', 'image_generation'];
// What the CLI needs from the environment (its home, login, proxy, the OS); nothing else of the server's reaches it.
const PASS_ENV = new RegExp(`^(?:${['PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE',
  'HOMEPATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'LOGNAME', 'LANG',
  'LC_\\w+', 'TZ', 'XDG_\\w+', 'CODEX_\\w+', 'OPENAI_\\w+', '(?:HTTPS?|ALL|NO)_PROXY', 'SSL_CERT_\\w+',
  'NODE_EXTRA_CA_CERTS'].join('|')})$`, 'i');
const num = (v: unknown, d: number) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

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

// Options (environment): bin (STUDIO_CODEX_BIN, "codex"), model, effort, timeoutMs (STUDIO_CODEX_TIMEOUT_MS, 300000),
// workDir (STUDIO_CODEX_WORK, <tmp>/folly-studio-codex), schema (STUDIO_CODEX_SCHEMA=0: no --output-schema),
// userConfig (STUDIO_CODEX_USER_CONFIG=1: read ~/.codex/config.toml after all).
type Options = Partial<{ env: NodeJS.ProcessEnv, bin: string, model: string, effort: string, timeoutMs: number,
  workDir: string, schema: boolean, userConfig: boolean, maxOutputBytes: number, log: Logger }>;
export function createCodexAdapter(o: Options = {}) {
  const env = o.env || process.env;
  const cfg = {
    bin: o.bin || env.STUDIO_CODEX_BIN || 'codex', model: o.model || 'gpt-6.1-sol', effort: o.effort || '',
    timeoutMs: o.timeoutMs ?? num(env.STUDIO_CODEX_TIMEOUT_MS, 300_000),
    workDir: path.resolve(o.workDir || env.STUDIO_CODEX_WORK || path.join(tmpdir(), 'folly-studio-codex')),
    schema: o.schema ?? env.STUDIO_CODEX_SCHEMA !== '0',
    userConfig: o.userConfig ?? env.STUDIO_CODEX_USER_CONFIG === '1',
    maxOutputBytes: o.maxOutputBytes ?? 4 << 20, log: o.log || console,
  };
  const childEnv = Object.fromEntries(Object.entries(env).filter(([k]) => PASS_ENV.test(k)));

  /** The argument list for one call: the answer to `out`, the schema from `schemaFile` when there is one, `images`
   * attached (a flag follows them: -i takes several). */
  function argsFor(cwd: string, out: string, schemaFile: string | null, images: string[] = []) {
    const args = ['exec', ...images.flatMap((f) => ['-i', f]), '--ephemeral', '--skip-git-repo-check', '--ignore-rules',
      '-s', 'read-only', '-C', cwd,
      '-m', cfg.model, '-o', out, '-c', 'web_search="disabled"', ...FEATURES_OFF.flatMap((f) => ['-c',
        `features.${f}=false`])];
    if (!cfg.userConfig) args.push('--ignore-user-config');
    if (cfg.effort) args.push('-c', `model_reasoning_effort="${cfg.effort}"`);
    if (schemaFile) args.push('--output-schema', schemaFile);
    return [...args, '-']; // the prompt: stdin
  }

  async function generate(ctx: Context) {
    const command = findExecutable(cfg.bin, { env });
    if (!command) {
      throw new GenerateError('The AI generator is not configured on this server.', `${cfg.bin} not found on PATH`);
    }
    const { system, schema } = ctx.prompt?.() ?? buildPrompt(ctx);
    // A repair is a fresh run (codex keeps no session here): the same prefix, then the last answer and what was wrong.
    const repair = ctx.repair ? `\nYour answer was:\n${JSON.stringify(ctx.repair.answer)}\n\n`
      + `${ctx.repair.message ?? buildRepairMessage(ctx.repair.errors)}\n` : '';
    const empty = path.join(cfg.workDir, 'empty');
    await fs.mkdir(empty, { recursive: true });
    const job = await fs.mkdtemp(path.join(cfg.workDir, 'job-'));
    try {
      const out = path.join(job, 'answer.json');
      const schemaFile = cfg.schema ? path.join(job, 'schema.json') : null;
      if (schemaFile) await fs.writeFile(schemaFile, JSON.stringify(strictSchema(schema)));
      const images = await Promise.all((ctx.repair?.images ?? []).map(async (png, i) => {
        const file = path.join(job, `still-${i + 1}.png`);
        await fs.writeFile(file, png);
        return file;
      }));
      const ran = await runCommand({ ...command, args: [...command.args, ...argsFor(empty, out, schemaFile, images)],
        input: `${system}\n\n${ctx.turn ?? buildUserMessage(ctx.text)}\n${repair}`, cwd: empty, env: childEnv,
        timeoutMs: cfg.timeoutMs, maxOutputBytes: cfg.maxOutputBytes, signal: ctx.signal });
      const said = ran.tail.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
      if (ran.killed === 'timeout') {
        throw new GenerateError('The AI generator took too long; please try again.', `codex: ${ran.ms} ms, no answer`);
      }
      if (ran.killed === 'abort') throw new GenerateError('The idea was stopped before it finished.', 'codex: aborted');
      if (ran.killed === 'output') {
        throw new GenerateError('The AI returned a look the studio could not read.', 'codex: too much output');
      }
      if (ran.code !== 0) {
        throw new GenerateError('The AI generator failed; please try again.', `codex exited ${ran.code ?? ran.signal}: `
          + said);
      }
      const look = pickLook(dropNulls(parseJson(await readAnswer(out))));
      if (!look) throw new GenerateError('The AI returned a look the studio could not read.', 'codex: not a look');
      return look;
    } finally {
      await fs.rm(job, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { name: 'codex', generate, argsFor, config: cfg };
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
