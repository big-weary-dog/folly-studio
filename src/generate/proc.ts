// A one-shot CLI call for a generator, never through a shell: the executable found on PATH (on Windows, an npm
// `.cmd` shim is read for the script it runs, which Node then runs directly, so no argument passes through cmd.exe),
// started with an argument array and its input on stdin, under a wall clock, an output cap and an AbortSignal. Any of
// those kills its whole process tree (its own process group on Linux and macOS; taskkill /T on Windows).
import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { GenerateError } from '../../shared/schemas/generated.ts';

export type Command = { cmd: string, args: string[] };

/** The call was cut by a signal this server did not send (a service stop reaching the whole group, a kill by hand):
 * not the model's failure, so the idea is not failed for it. */
export class Interrupted extends GenerateError {}
/** Signals that stop a process rather than report a fault in it. */
export const STOP_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP']);
type Env = Record<string, string | undefined>;

const isFile = (file: string) => {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch { return false; }
};

/**
 * The script an npm `.cmd` shim runs ("%dp0%\node_modules\…\bin\codex.js"), else the program (not node.exe, which
 * the shim only prefers for running the script), relative to the shim.
 */
export function shimTarget(text: string) {
  const targets = [...text.matchAll(/"%~?dp0%\\?([^"%]+\.(?:[cm]?js|exe))"/gi)].map((m) => m[1]!.replace(/^\\+/, ''));
  return targets.find((t) => /\.[cm]?js$/i.test(t)) ?? targets.find((t) => !/(?:^|\\)node\.exe$/i.test(t)) ?? null;
}

/**
 * Where `name` runs from: a path (with a directory in it) as given, else the first match on PATH. On Windows the
 * PATHEXT kinds are tried, and a `.cmd`/`.bat` shim becomes the Node script it wraps; null when nothing runnable.
 */
export function findExecutable(name: string, { env = process.env as Env, platform = process.platform } = {}):
  Command | null {
  const win = platform === 'win32';
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const dirs = /[\\/]/.test(name) ? [''] : String(env[pathKey] ?? '').split(win ? ';' : ':').filter(Boolean);
  const exts = !win || path.extname(name) ? [''] : String(env.PATHEXT || '.EXE;.CMD;.BAT').toLowerCase().split(';')
    .filter((e) => ['.exe', '.cmd', '.bat', '.com'].includes(e));
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = dir ? path.join(dir, name + ext) : name + ext;
      if (!isFile(file)) continue;
      if (!win || !/\.(?:cmd|bat)$/i.test(file)) return { cmd: file, args: [] };
      let target;
      try { target = shimTarget(readFileSync(file, 'utf8').slice(0, 8192)); } catch { target = null; }
      const resolved = target && path.join(path.dirname(file), ...target.split(/[\\/]/));
      if (!resolved || !isFile(resolved)) continue;
      return /\.exe$/i.test(resolved) ? { cmd: resolved, args: [] } : { cmd: process.execPath, args: [resolved] };
    }
  }
  return null;
}

/** Kill a process and everything it started. */
export function killTree(pid: number | undefined, platform = process.platform) {
  if (!pid) return;
  if (platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone already */ }
  }
}

export type Ran = { code: number | null, signal: string | null,
  killed: 'timeout' | 'idle' | 'abort' | 'output' | null,
  tail: string, ms: number };

/**
 * Run `cmd args` in `cwd` with `input` on stdin. Resolves when it exits (its tree killed then too, so nothing it left
 * behind lingers), with the last 4 KB it wrote to stderr (and to stdout, unless `stdout` takes all of that).
 * `idleMs`: its tree is killed too when it writes nothing to stdout for that long (a call that stalled). Rejects only
 * when it cannot start.
 */
export function runCommand({ cmd, args, input = '', cwd, env, timeoutMs, idleMs, maxOutputBytes = 4 << 20, signal,
  stdout }: Command & { input?: string, cwd: string, env: Env, timeoutMs: number, idleMs?: number,
    maxOutputBytes?: number, signal?: AbortSignal, stdout?: (chunk: Buffer) => void }): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const started = Date.now(), win = process.platform === 'win32';
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: !win, windowsHide: true,
      shell: false });
    let bytes = 0, tail = '', killed: Ran['killed'] = null, done = false;
    const kill = (why: NonNullable<Ran['killed']>) => {
      if (!killed && !done) { killed = why; killTree(child.pid); }
    };
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    let idle: NodeJS.Timeout | undefined;
    const quiet = () => {
      clearTimeout(idle);
      if (idleMs) idle = setTimeout(() => kill('idle'), idleMs);
    };
    quiet();
    const onAbort = () => kill('abort');
    signal?.addEventListener('abort', onAbort, { once: true });
    const take = (buf: Buffer, keep = true) => {
      bytes += buf.length;
      if (keep) tail = (tail + buf.toString('utf8')).slice(-4096);
      if (bytes > maxOutputBytes) kill('output');
    };
    child.stdout.on('data', (buf: Buffer) => { quiet(); stdout?.(buf); take(buf, !stdout); });
    child.stderr.on('data', (buf: Buffer) => take(buf));
    child.stdin.on('error', () => {}); // it may exit before reading everything
    child.stdin.end(input);
    const finish = () => {
      done = true;
      clearTimeout(timer);
      clearTimeout(idle);
      signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', (err) => { finish(); reject(err); });
    child.on('exit', (code, sig) => {
      finish();
      if (!win) killTree(child.pid); // anything it started and left running, holding our pipes
      const settle = () => {
        clearTimeout(late);
        child.stdout.destroy();
        child.stderr.destroy();
        resolve({ code, signal: sig, killed, tail, ms: Date.now() - started });
      };
      const late = setTimeout(settle, 250); // the last of its output, unless something still holds the pipes
      child.once('close', settle);
    });
    if (signal?.aborted) kill('abort');
  });
}
