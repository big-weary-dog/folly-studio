// The library the Pi plays from: public/patterns as the checkout has it (git pull brings new modules), and looks
// made only of it. A look's modules name library entries by `ref`; their code is always the library's, never the
// look's own, so nothing but our library runs on the machine that drives the lights.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { type LayerInput, upgradeGlobals } from '../../public/js/pattern-core.ts';
import { type Automation, automationFor, Bpm, Duration, Globals, type Globals as GlobalsType, Layers, LookTitle }
  from '../../shared/schemas/look.ts';

export type Entry = { name: string, kind: string, code: string };
export type Library = { entries: Map<string, Entry>, hash: string };
/** A look as the Pi keeps it (pi/looks/<id>.json): Studio's look, modules by ref, code optional and ignored. */
export type PiLook = { id: string, title: string, duration?: number, bpm?: number, globals?: Globals | null,
  automation?: Automation | null, layers: LayerInput[] };

const NAME = /^[a-z0-9-]{1,64}$/;

/** public/patterns' modules (sources, warps, filters) → by name, and a hash of them all (what the page shows). */
export function readLibrary(dir: string): Library {
  const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const entries = new Map<string, Entry>(), sum = createHash('sha256');
  for (const e of Array.isArray(index) ? index : []) {
    const kind = e?.kind ?? 'source';
    if (!NAME.test(e?.name) || !['source', 'warp', 'filter'].includes(kind)) continue;
    const code = readFileSync(path.join(dir, `${e.name}.js`), 'utf8');
    entries.set(e.name, { name: e.name, kind, code });
    sum.update(`${e.name}\0${kind}\0${code}\0`);
  }
  return { entries, hash: sum.digest('hex').slice(0, 12) };
}

function parsed<T>(what: string, schema: { safeParse(v: unknown): { success: true, data: T } | { success: false,
  error: { issues: { message: string }[] } } }, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new Error(`${what}: ${r.error.issues[0]?.message}`);
  return r.data;
}

/** The look with each module's code from the library by its ref, globals (a palette by name too) and automation
 * checked as Studio checks them; throws, saying what, if a module has no ref or something is wrong. */
export function resolveLook(look: PiLook, lib: Library): PiLook {
  if (!look || typeof look.id !== 'string' || !Array.isArray(look.layers) || !look.layers.length) {
    throw new Error('not a look: it needs an id and layers');
  }
  const layers = look.layers.map((l, i) => {
    if (!l || typeof l !== 'object') throw new Error(`layer ${i + 1} must be an object`);
    const modules = Array.isArray(l.modules) ? l.modules : [];
    if (!modules.length) throw new Error(`layer ${i + 1} has no modules`);
    return { ...l, id: l.id ?? `l${i + 1}`, modules: modules.map((m, j) => {
      const e = m && typeof m.ref === 'string' ? lib.entries.get(m.ref) : undefined;
      if (!e) {
        const why = m?.ref ? `no library module ${m.ref}` : 'not a library module';
        throw new Error(`layer ${i + 1}, module ${j + 1}: ${why}`);
      }
      return { ...m, id: m.id ?? `m${j + 1}`, kind: e.kind, code: e.code } as typeof m;
    }) };
  });
  const now = upgradeGlobals(look);    // looks from before: energy a macro, the old globals gone
  const globals = parsed<GlobalsType | null>('globals', Globals, now.globals ?? null);
  const automation = parsed('automation', automationFor(globals), now.automation ?? null);
  return { ...look, title: parsed('title', LookTitle, look.title || look.id),
    duration: parsed('duration', Duration, look.duration ?? 30), bpm: parsed('bpm', Bpm, look.bpm ?? null) ?? undefined,
    layers: parsed('layers', Layers, layers), globals, automation };
}

/** Every look in `dirs` (later ones replace earlier by id), each resolved or with the reason it cannot play. */
export function readLooks(dirs: readonly string[], lib: Library) {
  const looks = new Map<string, { look: PiLook | null, file: string, error?: string }>();
  for (const dir of dirs) {
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f), id = f.slice(0, -5);
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        const many = Array.isArray(raw?.looks);
        for (const [i, entry] of (many ? raw.looks : [raw]).entries()) {
          const stable = [entry?.origin, entry?.id].find(v => typeof v === 'string' && v.length > 0);
          const key = many ? stable ?? `${id}#${i + 1}` : id;
          try {
            if (many && !stable) throw new Error('not a look: it needs an origin or id');
            looks.set(key, { look: resolveLook({ ...entry, id: key }, lib), file });
          } catch (e) {
            looks.set(key, { look: null, file, error: (e as Error).message });
          }
        }
      } catch (e) {
        looks.set(id, { look: null, file, error: (e as Error).message });
      }
    }
  }
  return looks;
}
