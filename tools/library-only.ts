#!/usr/bin/env node
// The library-only step on a data folder by hand (SPEC-looks "Library only"; the server runs it at start).
//
//   node tools/library-only.ts [--data <dir>] [--dry-run]
//
// --data: STUDIO_DATA, else data/ in the repo. --dry-run: list what it would drop and change, writing nothing. Without
// it the folder must not be in use (the server's lock); it backs up looks.json and users.json beside them first.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dropLine, migrateLibraryOnly } from '../src/library-only-data.ts';

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dataDir = path.resolve(opt('--data') || process.env.STUDIO_DATA
  || fileURLToPath(new URL('../data/', import.meta.url)));
const patternsDir = fileURLToPath(new URL('../public/patterns/', import.meta.url));
const dryRun = args.includes('--dry-run');
const say = (...a: unknown[]) => { process.stdout.write(`${a.join(' ')}\n`); };
try {
  const r = await migrateLibraryOnly({ dataDir, patternsDir, dryRun, log: { warn: say } });
  if (r.done) {
    say(`${dataDir}: already library only`);
  } else {
    const will = dryRun ? 'would drop' : 'dropped';
    for (const d of r.dropped) say(`${will} ${dropLine(d)}`);
    say(`${dataDir}: ${r.dropped.filter((d) => !d.version).length} looks and `
      + `${r.dropped.filter((d) => d.version).length} versions ${will}; ${r.changed} kept looks `
      + `${dryRun ? 'would move' : 'moved'} to the current library; ${r.grants} users' AI grants `
      + `${dryRun ? 'would go' : 'gone'}${r.backups.length ? `; backups: ${r.backups.join(', ')}` : ''}`);
  }
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}
