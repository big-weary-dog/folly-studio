#!/usr/bin/env node
// A dated backup of the studio's data dir as a .tar.gz, safe while the server runs.
//
//   node tools/backup.ts [--data <dir>] [--out <dir>] [--frames] [--keep <n>]
//
// --data: STUDIO_DATA, else data/ in the repo. --out: where the archive goes, default <data>-backups/ beside it.
// --keep: then remove all but the newest n archives there. The first line printed names the archive.
// The store writes each JSON file whole and renames it into place, so one read is one version of it; the
// files are listed and read until a pass finds the list the same and none replaced while it read, so the set is
// from one moment. Any error but a file removed meanwhile fails the backup rather than leave a file out. Baked
// frames (frames/*.fseq) only with --frames: the render box can bake them again. Their wire folders never
// (rebuilt on demand). The archive is written beside its final name, synced, then renamed into place.
// It holds password hashes and session hashes: keep it as private as the server.

import { constants as FS, createWriteStream, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const BLOCK = 512;
const sigOf = (st: Stats) => `${st.ino}:${st.size}:${st.mtimeMs}`;

/** A ustar header for a regular file. */
function header(name: string, size: number, mtime: number) {
  const h = Buffer.alloc(BLOCK);
  const put = (text: string, at: number, len: number) => h.write(text, at, len, 'utf8');
  const octal = (n: number, at: number, len: number) => put(`${n.toString(8).padStart(len - 1, '0')}\0`, at, len);
  if (Buffer.byteLength(name) > 100) throw new Error(`backup: name too long for tar: ${name}`);
  put(name, 0, 100);
  octal(0o600, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(size, 124, 12);
  octal(Math.floor(mtime / 1000), 136, 12);
  put('        ', 148, 8); // the checksum counts its own field as spaces
  put('0', 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return h;
}
const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/** A missing file is null (removed meanwhile); any other error stops the backup. */
const gone = (err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err; };

/** The data dir's JSON files, listed and read until a pass finds the list the same and no file replaced while it
 * read: [{ name, body, mtime }]. */
type File = { name: string, body: Buffer, mtime: number };
export async function snapshot(dataDir: string, { attempts = 50 } = {}): Promise<File[]> {
  const list = async () => (await fs.readdir(dataDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort();
  const stat = (n: string) => fs.stat(path.join(dataDir, n)).catch(gone);
  for (let i = 0, names = await list(); i < attempts; i++) {
    const before = await Promise.all(names.map(stat));
    const bodies = await Promise.all(names.map((n) => fs.readFile(path.join(dataDir, n)).catch(gone)));
    const after = await Promise.all(names.map(stat));
    const listed = await list();
    if (listed.join('/') === names.join('/')
      && before.every((st, k) => st && after[k] && sigOf(st) === sigOf(after[k]) && bodies[k])) {
      return names.map((name, k) => ({ name, body: bodies[k]!, mtime: after[k]!.mtimeMs }));
    }
    names = listed;
    await new Promise((r) => setTimeout(r, 20 + 20 * i));
  }
  throw new Error('backup: the data files kept changing; try again');
}

/** The archive's entries one after another: header, bytes, padding; then the two empty blocks. `count.entries` is
 * how many went in: a frame removed before it was opened is not one. */
async function* tarStream(root: string, files: File[], frames: string[], count: { entries: number }) {
  for (const f of files) {
    yield header(`${root}/${f.name}`, f.body.length, f.mtime);
    yield f.body;
    yield padding(f.body.length);
    count.entries++;
  }
  for (const file of frames) {
    // An open file keeps the version it opened: a bake renamed over it later does not change what is read.
    const fh = await fs.open(file, FS.O_RDONLY | FS.O_NOFOLLOW).catch(gone);
    if (!fh) continue;
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw new Error(`backup: ${file} is not a file`);
      yield header(`${root}/frames/${path.basename(file)}`, st.size, st.mtimeMs);
      for (let at = 0; at < st.size;) {
        const { bytesRead, buffer } = await fh.read({ buffer: Buffer.alloc(Math.min(1 << 20, st.size - at)),
          position: at });
        if (!bytesRead) throw new Error(`backup: ${file} shrank while it was read`);
        yield buffer.subarray(0, bytesRead);
        at += bytesRead;
      }
      yield padding(st.size);
      count.entries++;
    } finally {
      await fh.close();
    }
  }
  yield Buffer.alloc(2 * BLOCK);
}

/** backup({ dataDir, outDir, frames = false, now }) → { file, entries, bytes } */
export async function backup({ dataDir, outDir = `${path.resolve(dataDir)}-backups`,
  frames = false, now = new Date() }: { dataDir: string, outDir?: string, frames?: boolean, now?: Date }) {
  const files = await snapshot(dataDir);
  const framesDir = path.join(dataDir, 'frames');
  const fseqs = frames ? ((await fs.readdir(framesDir).catch(gone)) ?? [])
    .filter((n) => n.endsWith('.fseq')).sort().map((n) => path.join(framesDir, n)) : [];
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  const root = `folly-studio-${stamp}`;
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${root}.tar.gz`);
  const tmp = `${file}.${process.pid}.tmp`, count = { entries: 0 };
  try {
    const out = createWriteStream(tmp, { mode: 0o600 });
    await pipeline(tarStream(root, files, fseqs, count), zlib.createGzip({ level: 6 }), out);
    const fh = await fs.open(tmp, 'r');
    await fh.sync();
    await fh.close();
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { file, entries: count.entries, bytes: (await fs.stat(file)).size };
}

const ARCHIVE = /^folly-studio-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.tar\.gz$/;
/** Removes all but the newest `keep` (≥ 1) archives in `outDir`, by their dated names; nothing else there. */
const checkKeep = (keep: number) => {
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`backup: --keep ${keep}: a whole number, at least 1`);
};
export async function prune(outDir: string, keep: number) {
  checkKeep(keep);
  const old = (await fs.readdir(outDir)).filter((n) => ARCHIVE.test(n)).sort().slice(0, -keep);
  for (const name of old) await fs.rm(path.join(outDir, name));
  return old;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dataDir = path.resolve(opt('--data') || process.env.STUDIO_DATA
    || fileURLToPath(new URL('../data/', import.meta.url)));
  const out = opt('--out'), outDir = out ? path.resolve(out) : undefined;
  try {
    const keep = opt('--keep') === undefined ? undefined : Number(opt('--keep'));
    if (keep !== undefined) checkKeep(keep);
    const r = await backup({ dataDir, outDir, frames: args.includes('--frames') });
    process.stdout.write(`${r.file}: ${r.entries} files, ${(r.bytes / 1024).toFixed(1)} KB\n`);
    if (keep !== undefined) {
      for (const name of await prune(path.dirname(r.file), keep)) process.stdout.write(`removed ${name}\n`);
    }
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  }
}
