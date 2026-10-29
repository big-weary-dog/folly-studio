// Ship earlier library fingerprints for the save gate, including in Pi bundles without git history.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024 });
const hashes: Record<string, string[]> = {};
const blobs = new Set<string>();
const commits = git('rev-list', 'HEAD', '--', 'public/patterns').trim().split('\n');
for (const commit of commits) {
  const tree = git('ls-tree', commit, 'public/patterns/').trim().split('\n');
  const files = new Map(tree.map((line) => {
    const [meta, name] = line.split('\t');
    return [name, meta.split(' ')[2]];
  }));
  const index = files.get('public/patterns/index.json');
  if (!index) continue;
  const entries = JSON.parse(git('cat-file', 'blob', index));
  for (const entry of entries) {
    if (entry.kind === 'preset' || !/^[a-z0-9-]{1,64}$/.test(entry.name)) continue;
    const blob = files.get(`public/patterns/${entry.name}.js`);
    if (!blob || blobs.has(`${entry.name}:${blob}`)) continue;
    blobs.add(`${entry.name}:${blob}`);
    (hashes[entry.name] ??= []).push(createHash('sha256').update(git('cat-file', 'blob', blob)).digest('hex'));
  }
}
writeFileSync(new URL('../public/patterns/history.json', import.meta.url),
  `${JSON.stringify(Object.fromEntries(Object.entries(hashes).sort().map(([name, list]) =>
    [name, [...new Set(list)].sort()])), null, 2)}\n`);
