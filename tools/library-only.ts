#!/usr/bin/env node
// The library-only step on a data folder, by hand (SPEC-looks "Library only"; the server never runs it).
//
//   node tools/library-only.ts [--data <dir>] [--apply]
//
// --data: STUDIO_DATA, else data/ in the repo. Without --apply it is a dry run: it lists what it would drop, each look
// it would change and how (layers switched off retired patterns or dropped; apart, edited copies), writing nothing. With it, the folder must not be in use (stop the server: its lock), and it backs up looks.json
// and users.json beside them first.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { changeLines, dropLine, migrateLibraryOnly } from '../src/library-only-data.ts';

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dataDir = path.resolve(opt('--data') || process.env.STUDIO_DATA
  || fileURLToPath(new URL('../data/', import.meta.url)));
const patternsDir = fileURLToPath(new URL('../public/patterns/', import.meta.url));
const dryRun = !args.includes('--apply');
const say = (...a: unknown[]) => { process.stdout.write(`${a.join(' ')}\n`); };
try {
  const r = await migrateLibraryOnly({ dataDir, patternsDir, dryRun, log: { warn: say } });
  if (r.done) {
    say(`${dataDir}: already library only`);
  } else {
    const will = dryRun ? 'would drop' : 'dropped';
    for (const d of r.dropped) say(`${will} ${dropLine(d)}`);
    const lines = (edited: boolean) => r.changes.flatMap((c) => changeLines(edited ? { ...c, switched: [] }
      : { ...c, edited: [] }));
    for (const line of lines(false)) say(`${dryRun ? 'would change' : 'changed'} ${line}`);
    for (const line of lines(true)) say(`${dryRun ? 'would replay' : 'replayed'} ${line}`);
    say(`${dataDir}: ${r.dropped.filter((d) => !d.version).length} looks and `
      + `${r.dropped.filter((d) => d.version).length} versions ${will}; ${r.changed} kept looks `
      + `${dryRun ? 'would move' : 'moved'} to the current library, ${r.rebaked} of them onto new code, so their `
      + `bake and review ${dryRun ? 'would go' : 'gone'}; ${r.grants} users' AI grants `
      + `${dryRun ? 'would go' : 'gone'}${r.backups.length ? `; backups: ${r.backups.join(', ')}` : ''}`);
  }
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}
