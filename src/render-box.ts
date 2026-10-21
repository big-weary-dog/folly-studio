// The render box: render-box/render.ts under bubblewrap, for any look (SPEC "Baked frames"). There is
// no unboxed fallback: without bubblewrap or user namespaces, probe() says why and render() refuses.

import { execFile, spawn } from 'node:child_process';
import { constants as FS, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BAKE_SECONDS, framesBytesFor } from './bake.ts';
import { busEnv, scopeLimits } from './box-limits.ts';
import { BakeError, cleanBoxStats, CONTROL, readUntrusted } from './box-output.ts';
import type { LayerInput } from '../public/js/pattern-core.ts';
import { type Config, configOf } from './config.ts';
import { bundle } from './core-script.ts';
import type { Logger } from './http.ts';

const STUDIO = fileURLToPath(new URL('../', import.meta.url));
const SECOND = 1000;
const FPS = 40;

async function which(cmd: string, PATH: string | undefined) {
  if (cmd.includes('/')) return cmd;
  for (const dir of String(PATH || '/usr/bin:/bin').split(':')) {
    const p = path.join(dir || '.', cmd);
    if (await fs.access(p, FS.X_OK).then(() => true, () => false)) return p;
  }
  return null;
}

// The node binary and the libraries it loads (ldd), as read-only binds at their own paths, with
// LD_LIBRARY_PATH for them. A static node needs none; without ldd, the system lib dirs.
async function runtimeBinds(node: string) {
  const real = await fs.realpath(node);
  const out = await new Promise<string | null>((resolve) => {
    execFile('ldd', [real], { timeout: 10 * SECOND }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
  const binds: string[] = [];
  if (out === null) {
    const dirs = ['/usr/lib', '/usr/lib64', '/lib', '/lib64'];
    for (const d of dirs) if (await fs.stat(d).catch(() => null)) binds.push('--ro-bind', await fs.realpath(d), d);
    return { node: real, binds, libraryPath: dirs.join(':') };
  }
  const libs = [...new Set([...out.matchAll(/(\/[^\s()]+)\s+\(0x[0-9a-f]+\)/g)].map((m) => m[1]!))];
  for (const lib of libs) binds.push('--ro-bind', await fs.realpath(lib), lib);
  return { node: real, binds, libraryPath: [...new Set(libs.map((l) => path.dirname(l)))].join(':') };
}

/**
 * The box: probe(), render(job) → { bytes, boxStats, ms, seconds }. Each render gets a fresh folder with the core as
 * one script (src/core-script.ts, from its source) and an empty /out, in its own systemd user scope (tasks, memory;
 * src/box-limits.ts has the fallback), under prlimit (CPU, file size) and a wall clock, in `bwrap --unshare-all
 * --cap-drop ALL --clearenv` with everything read-only but /out and a 16 MB /tmp. No RLIMIT_AS: V8 reserves large
 * ranges up front and it crashes; RLIMIT_DATA caps writable maps. Options (environment): seconds
 * (STUDIO_BAKE_SECONDS, 120, ≤ 600), timeoutMs (STUDIO_BAKE_TIMEOUT; 30 s + 1.5 s per second baked, ≥ 90 s),
 * cpuSeconds (STUDIO_BAKE_CPU; likewise, ≥ 120), tasks (STUDIO_BAKE_TASKS, 256), memoryBytes (STUDIO_BAKE_MEMORY,
 * 1 GB; 0 = none), maxFramesBytes (STUDIO_BAKE_MAX_FRAMES; 64 MB or what `seconds` needs), nice (STUDIO_BAKE_NICE, 10:
 * the box runs at low priority), frameTimeoutMs (2 s), publicDir, script, node, bwrap, prlimit, systemdRun ('' = no
 * scope), tmpRoot.
 */
type Options = Partial<Record<'publicDir' | 'script' | 'fseqFile' | 'rigFile' | 'coreFile' | 'patternsDir' | 'node'
  | 'bwrap' | 'prlimit' | 'systemdRun' | 'tmpRoot', string> & Record<'seconds' | 'timeoutMs' | 'cpuSeconds' | 'tasks'
  | 'nice' | 'memoryBytes' | 'maxFramesBytes' | 'frameTimeoutMs', number> & { env: NodeJS.ProcessEnv, config: Config,
  log: Logger }>;
export type RenderBox = ReturnType<typeof createRenderBox>;
/** What a bake renders: the look on the box's stdin. */
type Job = { layers: readonly LayerInput[], seconds?: number, globals?: unknown, automation?: unknown, bpm?: unknown };
type Probe = { ok: true } | { ok: false, reason: string };

export function createRenderBox(o: Options = {}) {
  const env = o.env || process.env, c = o.config ?? configOf(env);
  const publicDir = path.resolve(o.publicDir || path.join(STUDIO, 'public'));
  const asked = o.seconds ?? (c.STUDIO_BAKE_SECONDS || DEFAULT_BAKE_SECONDS);
  const seconds = Math.min(600, Math.max(1, Math.round(asked)));
  const cfg = {
    seconds,
    timeoutMs: o.timeoutMs ?? c.STUDIO_BAKE_TIMEOUT ?? null, // null: scaled per bake
    cpuSeconds: o.cpuSeconds ?? (c.STUDIO_BAKE_CPU || null),
    tasks: o.tasks ?? (c.STUDIO_BAKE_TASKS || 256),
    nice: Math.min(19, Math.max(0, Math.round(o.nice ?? c.STUDIO_BAKE_NICE ?? 10))),
    memoryBytes: o.memoryBytes ?? c.STUDIO_BAKE_MEMORY ?? 1024 ** 3,
    maxFramesBytes: o.maxFramesBytes ?? c.STUDIO_BAKE_MAX_FRAMES ?? framesBytesFor(seconds),
    frameTimeoutMs: o.frameTimeoutMs ?? 2 * SECOND,
    script: o.script || path.join(STUDIO, 'render-box/render.ts'),
    files: {   // what the box sees beside render.ts, and where it comes from
      'package.json': path.join(STUDIO, 'render-box/package.json'),
      'renderer.ts': path.join(STUDIO, 'render-box/renderer.ts'),
      'fseq.ts': o.fseqFile || path.join(publicDir, 'js/fseq.ts'),
      'rig.json': o.rigFile || path.join(publicDir, 'data/rig.json'),
    },
    coreFile: o.coreFile || path.join(publicDir, 'js/pattern-core.ts'),
    patternsDir: o.patternsDir || path.join(publicDir, 'patterns'),    // the library, for use()
    node: o.node || process.execPath, bwrap: o.bwrap || 'bwrap', prlimit: o.prlimit || 'prlimit',
    systemdRun: o.systemdRun ?? 'systemd-run',
    tmpRoot: o.tmpRoot || tmpdir(), log: o.log || console,
  };
  const children = new Set<ReturnType<typeof spawn>>();
  const boxScript = () => `/box/${path.basename(cfg.script)}`; // its own name: Node runs a .ts one as TypeScript
  let probed: Promise<Probe> | undefined;
  let found: ReturnType<typeof findTools> | null = null;
  const tools = () => (found ||= findTools().catch((err) => { found = null; throw err; }));

  async function findTools() {
    const missing = (what: string) => new BakeError(`The render box is not available: ${what} is not installed on this `
      + 'server.');
    const bwrap = await which(cfg.bwrap, env.PATH);
    if (!bwrap) throw missing('bubblewrap (bwrap)');
    const prlimit = await which(cfg.prlimit, env.PATH);
    if (!prlimit) throw missing('prlimit (util-linux)');
    for (const f of [cfg.script, cfg.coreFile, ...Object.values(cfg.files)]) {
      if (!(await fs.stat(f).catch(() => null))?.isFile()) {
        throw new BakeError('The render box is not set up on this server.', `missing ${f}`);
      }
    }
    if (!(await fs.stat(cfg.patternsDir).catch(() => null))?.isDirectory()) {
      throw new BakeError('The render box is not set up on this server.', `missing ${cfg.patternsDir}`);
    }
    const nice = cfg.nice > 0 ? await which('nice', env.PATH) : null;
    const systemdRun = cfg.systemdRun ? await which(cfg.systemdRun, env.PATH) : null;
    const scope = await scopeLimits(systemdRun, cfg.node, env);
    const memory = cfg.memoryBytes > 0 ? (scope.pids && scope.memory ? 'MemoryMax' : 'RLIMIT_DATA') : 'no memory cap';
    if (scope.pids) cfg.log.info?.(`[bake] render box: a systemd user scope per bake (TasksMax, ${memory})`);
    else cfg.log.warn?.(`[bake] render box: no systemd user scope, so no task cap but the account's; ${memory}`);
    return { bwrap, prlimit, nice, systemdRun: scope.pids ? systemdRun : null, scope,
      runtime: await runtimeBinds(cfg.node) };
  }

  // Time budgets grow with the bake: 30 s plus 1.5 s per second of frames (a 25 ms frame is real time).
  const budget = (secs: number) => ({
    timeoutMs: cfg.timeoutMs ?? Math.max(90, 30 + 1.5 * secs) * SECOND,
    cpuSeconds: cfg.cpuSeconds ?? Math.ceil(Math.max(120, 30 + 1.5 * secs)),
  });

  type Ran = { code: number | null, signal: string | null, timedOut: boolean, stderr: string, error?: Error };
  function run(t: Awaited<ReturnType<typeof findTools>>, work: string | null, command: string[], input: string,
    timeoutMs: number, cpuSeconds = budget(cfg.seconds).cpuSeconds): Promise<Ran> {
    // The bake's own cgroup counts its tasks and memory alone (src/box-limits.ts).
    const scope = t.systemdRun ? [t.systemdRun, '--user', '--scope', '--quiet', '--collect', '-p',
      `TasksMax=${cfg.tasks}`] : [];
    const limits = [`--cpu=${cpuSeconds}`, `--fsize=${cfg.maxFramesBytes + 1024 * 1024}`, '--core=0'];
    if (cfg.memoryBytes > 0 && t.systemdRun && t.scope.memory) {
      scope.push('-p', `MemoryMax=${cfg.memoryBytes}`, '-p', 'MemorySwapMax=0');
    } else if (cfg.memoryBytes > 0) limits.push(`--data=${cfg.memoryBytes}`);
    const argv = [
      ...scope, ...(scope.length ? ['--'] : []), t.prlimit, ...limits, '--', t.bwrap,
      '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
      '--setenv', 'LD_LIBRARY_PATH', t.runtime.libraryPath, '--setenv', 'TMPDIR', '/tmp',
      '--proc', '/proc', '--dev', '/dev', '--size', String(16 * 1024 * 1024), '--tmpfs', '/tmp',
      ...t.runtime.binds,
      '--ro-bind', t.runtime.node, '/box/node',
      '--ro-bind', cfg.script, boxScript(),
      ...Object.entries(cfg.files).flatMap(([name, from]) => ['--ro-bind', from, `/box/${name}`]),
      '--ro-bind', cfg.patternsDir, '/box/patterns',
      ...(work ? ['--ro-bind', path.join(work, 'pattern-core.js'), '/box/pattern-core.js'] : []),
      ...(work ? ['--bind', path.join(work, 'out'), '/out'] : []),
      '--remount-ro', '/', '--chdir', '/box',
      '--', '/box/node', '--max-old-space-size=512', '--disallow-code-generation-from-strings', ...command,
    ];
    return new Promise((resolve) => {
      // Under nice, so a bake never starves the server or the machine it shares.
      const [cmd, ...args] = t.nice ? [t.nice, '-n', String(cfg.nice), ...argv] : argv;
      const child = spawn(cmd!, args, { stdio: ['pipe', 'ignore', 'pipe'], env: t.systemdRun ? busEnv(env) : {} });
      children.add(child);
      let stderr = '', timedOut = false;
      // bwrap --die-with-parent takes the whole box down with it
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4096)));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      const done = (code: number | null, signal: string | null, error?: Error) => {
        clearTimeout(timer);
        children.delete(child);
        resolve({ code, signal, timedOut, stderr: stderr.trim(), error });
      };
      child.on('error', (err) => done(null, null, err));
      child.on('close', (code, signal) => done(code, signal));
    });
  }

  /** Can this server run the box? Checked once (a few tens of ms), then remembered. */
  function probe() {
    probed ||= (async (): Promise<Probe> => {
      let t;
      try {
        t = await tools();
      } catch (err) {
        return { ok: false, reason: (err as BakeError).reason || String((err as Error).message) };
      }
      const r = await run(t, null, ['-e', '0'], '', 30 * SECOND);
      if (r.code === 0) return { ok: true };
      cfg.log.warn?.(`[bake] render box probe failed: ${r.error?.message || r.stderr || `exit ${r.code}`}`);
      return { ok: false, reason: 'The render box is not available: bubblewrap cannot create its namespaces on '
        + 'this server (user namespaces may be disabled).' };
    })();
    return probed;
  }

  /**
   * Bake layers (with their clips), globals and automation to FSEQ bytes, `seconds` long (at most the box's).
   * Throws BakeError.
   */
  async function render({ layers, seconds: want, globals, automation, bpm }: Job) {
    const p = await probe();
    if (!p.ok) throw new BakeError(p.reason);
    const t = await tools();
    const secs = Math.round(Math.min(cfg.seconds, want! > 0 ? want! : cfg.seconds) * FPS) / FPS || 1 / FPS;
    const { timeoutMs, cpuSeconds } = budget(secs);
    const work = await fs.mkdtemp(path.join(cfg.tmpRoot, 'folly-bake-'));
    const out = path.join(work, 'out');
    try {
      await fs.mkdir(out);
      await fs.writeFile(path.join(work, 'pattern-core.js'), bundle(cfg.coreFile).text);
      const command = [boxScript(), '--out', '/out', '--seconds', String(secs),
        '--frame-ms', String(cfg.frameTimeoutMs)];
      const started = Date.now();
      const look = { layers, ...(globals ? { globals } : {}), ...(automation ? { automation } : {}),
        ...(bpm ? { bpm } : {}) };
      const r = await run(t, work, command, JSON.stringify(look), timeoutMs, cpuSeconds);
      const took = `The bake took longer than ${Math.round(timeoutMs / SECOND)} s and was stopped.`;
      if (r.timedOut) throw new BakeError(took);
      const result = await readUntrusted(path.join(out, 'result.json'), { maxBytes: 64 * 1024, within: out })
        .then((b) => JSON.parse(b.toString('utf8')), () => null);
      const boxStats = result && typeof result === 'object' ? cleanBoxStats(result) : undefined;
      if (r.code !== 0) {
        const said = typeof result?.error === 'string' ? result.error.replace(CONTROL, ' ').slice(0, 300) : '';
        const reason =
          r.code === 128 + 24 ? `The bake used more than ${cpuSeconds} CPU seconds and was stopped.`
          : r.code === 128 + 25 ? 'The bake wrote more than its file-size limit and was stopped.'
          : said ? `The look could not be baked: ${said}`
          : 'The render box stopped without baking the look.';
        if (!said) {
          const why = r.error?.message || r.stderr.split('\n').slice(-3).join(' | ');
          cfg.log.warn?.(`[bake] render box exit ${r.code}${r.signal ? ` (${r.signal})` : ''}: ${why}`);
        }
        throw Object.assign(new BakeError(reason), { boxStats });
      }
      const bytes = await readUntrusted(path.join(out, 'frames.fseq'), { maxBytes: cfg.maxFramesBytes, within: out })
        .catch((err: BakeError) => {
          const why = `The render box left no usable frames: ${err.reason || 'unreadable'}.`;
          throw Object.assign(new BakeError(why), { boxStats });
        });
      return { bytes, boxStats, ms: Date.now() - started, seconds: secs };
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { probe, render, stop: () => children.forEach((c) => c.kill('SIGKILL')), config: cfg };
}
