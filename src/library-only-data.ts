// The library-only step on a data folder (SPEC-looks "Library only"), once: the server runs it at start, before the
// store opens; `tools/library-only.ts` runs it by hand, or with --dry-run to say what it would do and change nothing.
// It copies looks.json and users.json beside themselves first and stops if that fails, then writes the looks kept and
// the users without the AI's grants, removes the dropped looks' frames (their previews and wire folders go at start,
// as no look names them), and last writes the marker that makes it done.
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { writeFileAtomic } from './atomic-file.ts';
import { removeFrames } from './bake.ts';
import { libraryFiles } from './library-history.ts';
import { type Dropped, libraryOnly, withoutAccess } from './library-only.ts';
import { lockDataDir } from './store-lock.ts';

export const MARKER = 'migrations.json', STEP = 'library-only';
type Node = Record<string, unknown>;
type Log = { info?: (...a: unknown[]) => void, warn?: (...a: unknown[]) => void };

const missing = (err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err; };

/** A collection's file: its bytes and documents as the store reads them, or null when there is none. */
async function collection(file: string) {
  const bytes = await fsp.readFile(file).catch(missing);
  if (bytes === null || !bytes.toString('utf8').trim()) return null;
  const data = JSON.parse(bytes.toString('utf8'));
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!items) throw new Error(`${STEP}: ${file} does not hold an array`);
  return { bytes, items: items.filter((x: unknown) => !!x && typeof (x as Node).id === 'string') as Node[] };
}

const text = (items: Node[]) => (items.length ? `[\n${items.map((x) => JSON.stringify(x)).join(',\n')}\n]\n`
  : '[]\n');

/** `bytes` as `file`, made new (never over another), synced. */
async function keep(file: string, bytes: Buffer) {
  const fh = await fsp.open(file, 'wx', 0o600);
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export const dropLine = (d: Dropped) => `${d.version ? `version ${d.version} of ` : ''}${d.look} "${d.title}" `
  + `(${d.owner || 'no owner'})`;

/**
 * Runs the step on `dataDir` against the library in `patternsDir`: { done } when it already had, else { dropped,
 * changed, backups } (none written when `dryRun`). A folder without the library is left for later.
 */
export async function migrateLibraryOnly({ dataDir, patternsDir, dryRun = false, now = new Date(), log = console }: {
  dataDir: string, patternsDir: string, dryRun?: boolean, now?: Date, log?: Log }) {
  const marker = path.join(dataDir, MARKER);
  const steps = await fsp.readFile(marker, 'utf8').then(JSON.parse, missing) as Node | null;
  if (steps?.[STEP]) return { done: true as const };
  const library = await libraryFiles(patternsDir, { retired: true });
  if (!library.size) {
    log.warn?.(`${STEP}: no library in ${patternsDir}; the data folder is left as it is`);
    return { done: false as const, dropped: [] as Dropped[], changed: 0, grants: 0, backups: [] as string[] };
  }
  await fsp.mkdir(dataDir, { recursive: true });
  const lock = dryRun ? null : await lockDataDir(dataDir);
  try {
    const looksFile = path.join(dataDir, 'looks.json'), usersFile = path.join(dataDir, 'users.json');
    const [looks, users] = await Promise.all([collection(looksFile), collection(usersFile)]);
    const kept = libraryOnly(library, looks?.items ?? []);
    const plain = users?.items.map(withoutAccess);
    const grants = users ? plain!.filter((u, i) => u !== users.items[i]).length : 0;
    const result = { done: false as const, dropped: kept.dropped, changed: kept.changed, grants,
      backups: [] as string[] };
    if (dryRun) return result;
    const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
    for (const [name, file] of [['looks', looks], ['users', users]] as const) {
      if (!file) continue;
      const backup = path.join(dataDir, `${name}.pre-${STEP}-${stamp}.json`);
      await keep(backup, file.bytes);
      result.backups.push(backup);
    }
    if (looks) await writeFileAtomic(looksFile, text(kept.looks));
    if (users && grants) await writeFileAtomic(usersFile, text(plain!));
    const framesDir = path.join(dataDir, 'frames');
    for (const d of kept.dropped) {
      if (!d.version) await removeFrames(framesDir, d.look);
      log.info?.(`${STEP}: dropped ${dropLine(d)}: not library code`);
    }
    await writeFileAtomic(marker, `${JSON.stringify({ ...steps, [STEP]: now.toISOString() }, null, 2)}\n`);
    return result;
  } finally {
    await lock?.release();
  }
}
