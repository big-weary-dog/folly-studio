// The library-only step on a data folder (spec/looks "Library only"), once, by hand alone (`tools/library-only.ts`):
// the server never changes stored looks at start. A dry run says what it would do and changes nothing. It runs again
// on a folder that had it before retired patterns were switched (`migrations.json` without RETIRE).
// It copies looks.json and users.json beside themselves first and stops if that fails, then writes the looks kept and
// the users without the AI's grants, removes the frames of the looks dropped or whose code changed (their previews
// and wire folders go at start, as no bake names them), and last writes the marker that makes it done.
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { writeFileAtomic } from './atomic-file.ts';
import { removeFrames } from './bake.ts';
import { libraryFiles } from './library-files.ts';
import { type Changed, type Dropped, libraryOnly, withoutAccess } from './library-only.ts';
import { lockDataDir } from './store-lock.ts';

export const MARKER = 'migrations.json', STEP = 'library-only', RETIRE = 'retired-patterns';
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

const whose = (d: Dropped | Changed) => `${d.version ? `version ${d.version} of ` : ''}${d.look} "${d.title}" `
  + `(${d.owner || 'no owner'})`;
export const dropLine = (d: Dropped) => `${whose(d)}: ${d.why}`;
/** Each change to a kept look or version, a line each: its layers switched or dropped, then its edited copies. */
export const changeLines = (c: Changed) => [...c.switched.map((s) => `${whose(c)}: ${s}`),
  ...c.edited.map((e) => `${whose(c)}: ${e} held an edited or earlier copy; it plays as the library's`)];

/**
 * Runs the step on `dataDir` against the library in `patternsDir`: { done } when it already had, else { dropped,
 * changes, changed, backups } (none written when `dryRun`). Without the library it changes nothing.
 */
export async function migrateLibraryOnly({ dataDir, patternsDir, dryRun = true, now = new Date(), log = console }: {
  dataDir: string, patternsDir: string, dryRun?: boolean, now?: Date, log?: Log }) {
  const marker = path.join(dataDir, MARKER);
  const steps = await fsp.readFile(marker, 'utf8').then(JSON.parse, missing) as Node | null;
  if (steps?.[STEP] && steps[RETIRE]) return { done: true as const };
  const library = await libraryFiles(patternsDir, { strict: true });
  if (!library.modules.size) {
    log.warn?.(`${STEP}: no library in ${patternsDir}; the data folder is left as it is`);
    return { done: false as const, dropped: [] as Dropped[], changes: [] as Changed[], changed: 0, rebaked: 0,
      grants: 0, backups: [] as string[] };
  }
  if (!dryRun) await fsp.mkdir(dataDir, { recursive: true });
  const lock = dryRun ? null : await lockDataDir(dataDir);
  try {
    const looksFile = path.join(dataDir, 'looks.json'), usersFile = path.join(dataDir, 'users.json');
    const [looks, users] = await Promise.all([collection(looksFile), collection(usersFile)]);
    const kept = libraryOnly(library, looks?.items ?? []);
    const plain = users?.items.map(withoutAccess);
    const grants = users ? plain!.filter((u, i) => u !== users.items[i]).length : 0;
    const result = { done: false as const, dropped: kept.dropped, changes: kept.changes, changed: kept.changed,
      rebaked: kept.rebaked.length, grants, backups: [] as string[] };
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
    for (const id of kept.rebaked) await removeFrames(framesDir, id);
    for (const d of kept.dropped) {
      if (!d.version) await removeFrames(framesDir, d.look);
      log.info?.(`${STEP}: dropped ${dropLine(d)}`);
    }
    for (const c of kept.changes) for (const line of changeLines(c)) log.info?.(`${STEP}: ${line}`);
    const at = now.toISOString();
    const done = { ...steps, [STEP]: steps?.[STEP] ?? at, [RETIRE]: at };
    await writeFileAtomic(marker, `${JSON.stringify(done, null, 2)}\n`);
    return result;
  } finally {
    await lock?.release();
  }
}
