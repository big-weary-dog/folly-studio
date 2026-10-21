// One server per data folder: the store keeps every collection in memory and rewrites whole files, so a second
// process on the same folder would silently overwrite the first. `studio.lock` holds the owner's pid, made
// create-only (a hard link to a written temp file, so it is never seen empty); a lock whose pid is no longer
// running is taken over. Released on release() or at process exit.

import fs, { promises as fsp } from 'node:fs';
import path from 'node:path';

export const LOCK_FILE = 'studio.lock';

/** Another process holds the data folder. */
export class DataLockedError extends Error {}

/** Whether `pid` is a running process that may be a server: after a reboot its pid may be another program's (where
 * /proc says which). */
const running = (pid: number) => {
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  try {
    return /node/.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'latin1'));
  } catch {
    return true;
  }
};

/** Takes `<dataDir>/studio.lock`, or throws DataLockedError naming the folder and the pid holding it. */
export async function lockDataDir(dataDir: string) {
  const file = path.join(dataDir, LOCK_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${process.pid}\n`, { mode: 0o600 });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.link(tmp, file);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      const pid = Number.parseInt(await fsp.readFile(file, 'utf8').catch(() => ''), 10);
      if (attempt > 0 || (pid > 0 && running(pid))) {
        throw new DataLockedError(`another Folly Studio (pid ${pid || '?'}) is using the data folder ${dataDir}; `
          + `stop it first, or set STUDIO_DATA to another folder`);
      }
      await fsp.rm(file, { force: true }); // stale: its server stopped without releasing it
    }
  } finally {
    await fsp.rm(tmp, { force: true });
  }
  let held = true;
  const atExit = () => { if (held) fs.rmSync(file, { force: true }); };
  process.once('exit', atExit);
  return {
    file,
    async release() {
      if (!held) return;
      held = false;
      process.off('exit', atExit);
      await fsp.rm(file, { force: true });
    },
  };
}
