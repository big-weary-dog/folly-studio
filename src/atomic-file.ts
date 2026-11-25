// A file written whole or not at all: to a temporary beside it (unique, 0600), synced to disk, then renamed over it.
// Writes to one file go one at a time in call order, so the last call is what stays.
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const chains = new Map<string, Promise<void>>();
let seq = 0;

async function write(file: string, text: string | Uint8Array) {
  const tmp = `${file}.${process.pid}.${++seq}.tmp`;
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const fh = await fsp.open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(text);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Replaces `file` with `text` once the writes before it are done; rejects if this one failed. */
export function writeFileAtomic(file: string, text: string | Uint8Array): Promise<void> {
  const done = (chains.get(file) ?? Promise.resolve()).then(() => write(file, text));
  const tail = done.catch(() => {});
  chains.set(file, tail);
  void tail.then(() => { if (chains.get(file) === tail) chains.delete(file); });
  return done;
}
