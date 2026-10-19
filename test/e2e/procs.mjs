// What the browser checks leave behind, and the sweep that clears it (playwright.config.js runs this module before
// and after every run). A helper process (stack.mjs: the static server, the relay, sacn-play) carries in its
// environment the worker that started it, as pid:start, and so does whatever it starts. Helpers stay in the run's
// process group, so Ctrl-C reaches them, and their worker stops them in afterAll; one whose worker is gone (crashed,
// killed, an earlier run's) is killed by the sweep. A run's own output folder (STUDIO_PW_OUT) is per run too; the
// sweep removes those of runs that have ended.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OWNER = 'FOLLY_STUDIO_E2E_OWNER';
export const OUT_PREFIX = 'folly-studio-playwright-';
const PROC = fs.existsSync('/proc/self/stat');   // Linux; elsewhere nothing is swept

/** /proc/<pid>/stat's fields from the state on: [0] state, [19] start time (a reused pid has another). */
const stat = (pid) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
/** This process (or pid) as pid:start. */
export const identity = (pid = process.pid) => (PROC ? `${pid}:${stat(pid)[19]}` : String(pid));
function running(id) {
  const [pid] = id.split(':');
  try {
    return identity(pid) === id && stat(pid)[0] !== 'Z';
  } catch { return false; }
}

/** The environment for a helper this worker starts. */
export const tagged = (env = process.env) => ({ ...env, [OWNER]: identity() });

/** Every process carrying an owner: { pid, owner, cmd }. */
export function helpers() {
  if (!PROC) return [];
  const found = [];
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const owner = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
        .find((e) => e.startsWith(`${OWNER}=`))?.slice(OWNER.length + 1);
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
      if (owner && Number(pid) !== process.pid) found.push({ pid: Number(pid), owner, cmd });
    } catch { /* gone, or not ours to read */ }
  }
  return found;
}

/** SIGKILL the helpers of `owner`, or (by default) of every owner that has gone; returns what was killed. */
export function sweep(owner = null) {
  const doomed = helpers().filter((h) => (owner ? h.owner === owner : !running(h.owner)));
  for (const h of doomed) {
    try { process.kill(h.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  return doomed;
}

/** Processes one of whose arguments matches, as "pid: command" lines, to name a culprit in an error. */
export function named(pattern) {
  if (!PROC) return [];
  return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d) && Number(d) !== process.pid).flatMap((pid) => {
    try {
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      return args.some((a) => pattern.test(a)) ? [`${pid}: ${args.join(' ').trim()}`] : [];
    } catch { return []; }
  });
}

/** globalSetup and globalTeardown: orphaned helpers, and the output folders of runs that have ended. */
export default function sweepAll() {
  for (const h of sweep()) console.log(`swept an orphaned helper (its worker ${h.owner} is gone): ${h.pid} ${h.cmd}`);
  for (const name of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(OUT_PREFIX))) {
    const pid = Number(name.slice(OUT_PREFIX.length).split('-')[0]);
    const dir = path.join(os.tmpdir(), name);
    if (!pid || dir === process.env.STUDIO_PW_OUT) continue;
    try { process.kill(pid, 0); } catch (e) {
      if (e.code === 'ESRCH') fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
