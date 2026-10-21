// One server per data folder: the store keeps every collection in memory and rewrites whole files, so a second
// process on the same folder would silently overwrite the first. `studio.lock` holds the owner's pid, made
// create-only (a hard link to a written temp file, so it is never seen empty); a lock whose pid is no longer
// running is taken over by renaming ours over it, never by removing it, under a claim on that lock's inode that one
// taker alone can make. Released on release() or at process exit.

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

/** Puts our lock (`tmp`, holding our pid) over the stale one at `file`, whose inode is `ino`: true when it did. The
 * claim `<file>.<ino>.<n>` is a link to `tmp`, made create-only, so one taker holds it; a claim whose taker is no
 * longer running (cut short) is passed over for the next n. Under it, the lock is still that inode, since only a
 * claim's holder replaces a stale lock, and a rename replaces it whole: there is never a moment without one. */
async function takeOver(file: string, ino: number, tmp: string) {
  for (let n = 1; ; n++) {
    const claim = `${file}.${ino}.${n}`;
    try {
      await fsp.link(tmp, claim);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number.parseInt(await fsp.readFile(claim, 'utf8').catch(() => ''), 10);
      if (pid > 0 && running(pid)) return false;  // another taker is at it
      continue;
    }
    try {
      if ((await fsp.stat(file).catch(() => null))?.ino !== ino) return false;
      await fsp.rename(tmp, file);
      return true;
    } finally {
      await fsp.rm(claim, { force: true });
    }
  }
}

/** Takes `<dataDir>/studio.lock`, or throws DataLockedError naming the folder and the pid holding it. */
export async function lockDataDir(dataDir: string) {
  const file = path.join(dataDir, LOCK_FILE);
  const tmp = `${file}.${process.pid}.${++seq}.tmp`;
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
      // One open file, so its pid and its inode are the same lock's.
      const fh = await fsp.open(file, 'r').catch(() => null);
      if (!fh) continue;              // released meanwhile
      const [st, text] = await Promise.all([fh.stat(), fh.readFile('utf8')]).finally(() => fh.close());
      const pid = Number.parseInt(text, 10);
      if (pid > 0 && running(pid)) throw locked(pid);
      // Stale: its server stopped without releasing it. Another taker may be replacing it; then look again.
      if (await takeOver(file, st.ino, tmp)) break;
      if (attempt >= 50) throw locked(pid);
      await new Promise((r) => setTimeout(r, 10));
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
