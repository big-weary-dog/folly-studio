#!/usr/bin/env node
// Stored looks rewritten once as the current code reads them (docs/HOSTING.md "Rewrite stored looks"), so the server
// can stop upgrading them on every read:
//
//   node tools/rewrite-looks.ts [--data <dir>] [--apply]
//
// --data: STUDIO_DATA, else data/ in the repo. Without --apply it is a dry run: it says what it would change and
// writes nothing. With it, the server stopped (the data lock refuses otherwise), it copies looks.json beside itself
// (looks.pre-rewrite-<time>.json) and writes the rewritten looks. Each look and version gets: role remaps dropped and
// a chain from before the one rule converted (as the store's start-up upgrade does); the old globals gone, energy a
// macro where it plays (upgradeGlobals); each module's params through its pattern's upgrade(); and the hash of the
// code it was saved with (`codeHash`, from its stored code) before that code is dropped, refs alone kept. What plays
// is unchanged, so a bake current before stays current: its layersHash is written anew. Running it again changes
// nothing.
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { upgradeParams } from '../core/compile.ts';
import { compileModule, upgradeGlobals } from '../core/pattern-core.ts';
import { eachModule, type Node } from '../shared/look-modules.ts';
import { upgradeStored } from '../src/api-looks.ts';
import { writeFileAtomic } from '../src/atomic-file.ts';
import { layersHash, renderFields } from '../src/bake.ts';
import { libraryRefs } from '../src/library-refs.ts';
import { createLoaders, DEFAULT_PUBLIC_DIR } from '../src/static.ts';
import { lockDataDir } from '../src/store-lock.ts';
import type { StoredLook as Look } from '../src/store.ts';

type Refs = ReturnType<typeof libraryRefs>;
/** What a look's rewrite changed (empty: nothing), and whether its bake was current and so kept. */
export type Rewrite = { id: string, title: string, owner: string, changes: string[], bake: 'kept' | 'stale' | 'none' };

const json = (v: unknown) => JSON.stringify(v);
const versionsOf = (look: Node) => (Array.isArray(look.versions) ? look.versions as Node[] : []);

/** Each module's params of `layers` (changed in place) as its library code's upgrade() reads them; the titles of
 * those changed. */
function upgradeModules(layers: unknown, upgraderOf: (ref: unknown) => ReturnType<typeof compileModule> | null) {
  const changed: string[] = [];
  eachModule(layers, (m) => {
    const c = upgraderOf(m.ref);
    if (!c?.upgrade || !m.params || typeof m.params !== 'object') return;
    const now = upgradeParams(c, m.params);
    if (json(now) === json(m.params)) return;
    m.params = now;
    changed.push(String(m.title || m.ref));
  });
  return changed;
}

/** `node`'s globals and automation as they play now (with its layers' code filled, so code reading G.energy counts),
 * Live Play's `live` dropped; true when they changed. */
function upgradeNode(node: Node, filledLayers: unknown) {
  const was = json([node.globals, node.automation]);
  const now = upgradeGlobals({ globals: node.globals as never, automation: node.automation as never,
    layers: filledLayers });
  const { live: _, ...globals } = (now.globals ?? {}) as Node;
  if (now.globals) node.globals = globals;
  if ('automation' in now) node.automation = now.automation;
  return json([node.globals, node.automation]) !== was;
}

/** `stored` rewritten as the current code reads it, and what changed. */
export function rewriteLook(stored: Look, refs: Refs, upgraderOf: (ref: unknown) => ReturnType<typeof compileModule>
  | null): { look: Look, rewrite: Rewrite } {
  const filled = (look: Look) => refs.read(structuredClone(look));
  const before = filled(stored);
  const current = !!stored.bake && !!before.bake && stored.bake.layersHash === layersHash(renderFields(before));
  const changes: string[] = [];
  const up = structuredClone(upgradeStored(stored, { ...refs, filled })) as Look & Node;
  if (json(up.layers) !== json(stored.layers) || up.chain !== stored.chain) changes.push('chain or remaps converted');
  const read = filled(up) as Look & Node;
  for (const [node, i] of [[up, -1], ...versionsOf(up).map((v, j) => [v, j] as const)] as [Node, number][]) {
    const where = i < 0 ? '' : ` (version ${String(node.n ?? i + 1)})`;
    if (upgradeNode(node, (i < 0 ? read : versionsOf(read)[i])?.layers)) changes.push(`globals as they play${where}`);
    const params = upgradeModules(node.layers, upgraderOf);
    if (params.length) changes.push(`params upgraded: ${params.join(', ')}${where}`);
    let code = 0;
    eachModule(node.layers, (m) => { if (typeof m.code === 'string') code++; });
    if (code) changes.push(`code dropped from ${code} module${code > 1 ? 's' : ''}${where}`);
  }
  const look = refs.write(up) as Look;
  if (current) look.bake = { ...look.bake!, layersHash: layersHash(renderFields(filled(look))) };
  if (json(look) === json(stored)) changes.length = 0;
  return { look, rewrite: { id: stored.id, title: String(stored.title ?? ''), owner: String(stored.owner ?? ''),
    changes, bake: current ? 'kept' : stored.bake ? 'stale' : 'none' } };
}

const missing = (err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err; };

/** Rewrites `dataDir`'s looks against the library in `publicDir`: { rewrites, backup } (no backup on a dry run). */
export async function rewriteLooks({ dataDir, publicDir = DEFAULT_PUBLIC_DIR, apply = false, now = new Date() }: {
  dataDir: string, publicDir?: string, apply?: boolean, now?: Date }) {
  const loaders = createLoaders(publicDir, { log: { warn: (...a: unknown[]) => console.warn(...a) } as never });
  const library = loaders.loadLibrary();
  if (!library.some((e) => e.kind !== 'preset')) throw new Error(`rewrite-looks: no library in ${publicDir}`);
  const compiled = new Map<string, ReturnType<typeof compileModule> | null>();
  const upgraderOf = (ref: unknown) => {
    if (typeof ref !== 'string') return null;
    if (!compiled.has(ref)) {
      const e = library.find((x) => x.name === ref && x.kind !== 'preset');
      let c = null;
      try { c = e ? compileModule(e.code, (e.kind ?? 'source') as never) : null; } catch { c = null; }
      compiled.set(ref, c);
    }
    return compiled.get(ref)!;
  };
  const refs = libraryRefs(loaders.loadLibrary);
  const lock = apply ? await lockDataDir(dataDir) : null;
  try {
    const file = path.join(dataDir, 'looks.json');
    const bytes = await fsp.readFile(file).catch(missing);
    if (bytes === null || !bytes.toString('utf8').trim()) return { rewrites: [] as Rewrite[], backup: null };
    const data = JSON.parse(bytes.toString('utf8'));
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
    if (!items) throw new Error(`rewrite-looks: ${file} does not hold an array`);
    const rewrites: Rewrite[] = [];
    const out = items.map((item: unknown) => {
      if (!item || typeof item !== 'object' || typeof (item as Node).id !== 'string') return item;
      const { look, rewrite } = rewriteLook(item as Look, refs, upgraderOf);
      rewrites.push(rewrite);
      return look;
    });
    if (!apply || !rewrites.some((r) => r.changes.length)) return { rewrites, backup: null };
    const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
    const backup = path.join(dataDir, `looks.pre-rewrite-${stamp}.json`);
    const fh = await fsp.open(backup, 'wx', 0o600);
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await writeFileAtomic(file, out.length ? `[\n${out.map((x: unknown) => JSON.stringify(x)).join(',\n')}\n]\n`
      : '[]\n');
    return { rewrites, backup };
  } finally {
    await lock?.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dataDir = path.resolve(opt('--data') ?? process.env.STUDIO_DATA
    ?? fileURLToPath(new URL('../data', import.meta.url)));
  const apply = args.includes('--apply');
  try {
    const { rewrites, backup } = await rewriteLooks({ dataDir, apply });
    const changed = rewrites.filter((r) => r.changes.length);
    for (const r of changed) {
      const bake = r.bake === 'kept' ? 'its bake kept' : r.bake === 'stale' ? 'its bake already stale' : 'no bake';
      console.log(`${r.id} "${r.title}" (${r.owner || 'no owner'}), ${bake}:`);
      for (const c of r.changes) console.log(`  ${c}`);
    }
    const kept = backup ? `; the old file kept as ${path.basename(backup)}` : '';
    console.log(`${dataDir}: ${changed.length} of ${rewrites.length} looks ${apply ? 'rewritten' : 'to rewrite'}`
      + `${kept}${apply ? '' : ' (dry run: --apply writes)'}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
