// One server per data folder: the store keeps every collection in memory and rewrites whole files, so a second
// process on the same folder would silently overwrite the first. `studio.lock` holds the owner's pid, made
// create-only (a hard link to a written temp file, so it is never seen empty); a lock whose pid is no longer
// running is taken over. Released on release() or at process exit.

import fs, { promises as fsp } from 'node:fs';
import path from 'node:path';

export const LOCK_FILE = 'studio.lock';

/** Another process holds the data folder. */
export class DataLockedError extends Error {}

let seq = 0;   // this process's temporary names, each its own

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
  const own = `${file}.${process.pid}.${++seq}`, tmp = `${own}.tmp`;
  await fsp.writeFile(tmp, `${process.pid}\n`, { mode: 0o600 });
  try {
    const locked = (pid: number) => new DataLockedError(`another Folly Studio (pid ${pid || '?'}) is using the data `
      + `folder ${dataDir}; stop it first, or set STUDIO_DATA to another folder`);
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.link(tmp, file);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      const text = await fsp.readFile(file, 'utf8').catch(() => null);
      if (text === null) continue;    // released meanwhile
      const pid = Number.parseInt(text, 10);
      if (attempt >= 3 || (pid > 0 && running(pid))) throw locked(pid);
      // Stale: its server stopped without releasing it. Moved aside under our own name, then checked, so a lock
      // another server took since we read this one is put back, never removed.
      const aside = `${own}.stale`;
      try {
        await fsp.rename(file, aside);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      const moved = await fsp.readFile(aside, 'utf8').catch(() => '');
      if (moved !== text) await fsp.link(aside, file).catch(() => {});
      await fsp.rm(aside, { force: true });
      if (moved !== text) throw locked(Number.parseInt(moved, 10));
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
