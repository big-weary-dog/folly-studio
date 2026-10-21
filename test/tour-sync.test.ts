// The tutorial against the app (SPEC-tutorial): a step names controls, library entries, params, views and pages that
// must exist, so a rename anywhere fails here rather than leaving a step pointing at nothing. Each `data-tour` name a
// step uses is in the app's source (as written, or a `prefix:${…}` the source fills in, with a part that exists), each
// `{preset:x}`, `{module:x}` and `{param:x.key}` names the library's, and each practice look is made from modules the
// library has and saves as a look. tour.spec.js plays every path in the browser.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, test } from 'vitest';

import { compileModule } from '../public/js/pattern-core.ts';
import { layerFromPattern, presetLayers } from '../public/js/ui/model.ts';
import { type Recipe, practiceLook } from '../public/js/ui/tour/practice.ts';
import { PATHS } from '../public/js/ui/tour/paths/index.ts';
import type { Ctx, Step } from '../public/js/ui/tour/types.ts';
import { tourName, type TourView } from '../public/js/ui/tour-view.ts';
import { LookCreate } from '../shared/schemas/api.ts';
import { LibraryEntry, type ModuleEntry, type PresetEntry, type Rig } from '../shared/schemas/rig.ts';

const root = new URL('..', import.meta.url).pathname, read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const rig = JSON.parse(read('public/data/rig.json')) as Rig;
const library = (JSON.parse(read('public/patterns/index.json')) as unknown[]).map((e) => LibraryEntry.parse(e))
  .map((e) => ({ ...e, code: e.kind === 'preset' ? '' : read(`public/patterns/${e.name}.js`) })) as
  (ModuleEntry | PresetEntry)[];
const modules = new Map(library.filter((e): e is ModuleEntry => e.kind !== 'preset').map((e) => [e.name, e]));
const presets = new Map(library.filter((e): e is PresetEntry => e.kind === 'preset').map((e) => [e.name, e]));
const paramsOf = (name: string) => compileModule(modules.get(name)!.code, modules.get(name)!.kind).params;

const ui = (dir: string): string[] => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((f) =>
  (f.isDirectory() ? ui(`${dir}/${f.name}`) : /\.tsx?$/.test(f.name) ? [read(`${dir}/${f.name}`)] : []));
const source = ui('public/js/ui').join('\n');
/** The names the source writes out (`data-tour="x"`, `tour="x"`) and the prefixes it fills in (`` `x:${…}` ``). */
const written = new Set([...source.matchAll(/(?:data-tour|tour)="([^"]+)"/g)].flatMap((m) => m[1].split(' ')));
const filled = new Set([...source.matchAll(/(?:data-tour|tour)=\{(?:[\w.]+ && )?`([a-z-]+:)\$\{/g)].map((m) => m[1]));

const recipes = new Map(readdirSync(path.join(root, 'public/data/tutorial')).map((f) =>
  [f.replace(/\.json$/, ''), JSON.parse(read(`public/data/tutorial/${f}`)) as Recipe]));
type Made = { title: string; modules: { ref?: string }[] };
/** The layers a path's look has: its practice look's, or a new look's first (Studio setup()), and any layer a step
 * adds from the shelf (+ Add, then a preset or a source). */
function layersOf(p: (typeof PATHS)[number]): Made[] {
  const id = new URLSearchParams((p.look ?? p.start).split('?')[1]).get('tour');
  const first = library.find((e): e is ModuleEntry => (e.kind || 'source') === 'source')!;
  const added = p.steps.flatMap((s) => (Array.isArray(s.anchor) && s.anchor.includes('layers-add') ? s.anchor : []))
    .filter((a) => a.startsWith('shelf:')).map((a) => a.slice(6))
    .flatMap((n) => (presets.has(n) ? presetLayers(presets.get(n)!, library, rig)!
      : modules.has(n) ? [layerFromPattern(modules.get(n)!, rig)] : []));
  return [...(id ? practiceLook(recipes.get(id)!, library, rig)!.layers as Made[] : [layerFromPattern(first, rig)]),
    ...added];
}
const routes = [...read('public/js/ui/app.tsx').matchAll(/\['(\/[a-z]*)'/g)].map((m) => m[1]);
const docks = /DOCKS: Dock\[\] = \[([^\]]+)\]/.exec(source)![1].match(/[a-z]+/g)!;

/** Every name a step can point at: its list, or what its function gives with no Studio and on the path's look. */
function anchors(s: Step, layers: Made[]) {
  if (Array.isArray(s.anchor)) return s.anchor;
  const none = { value: null }, v = { layers: { value: layers, peek: () => layers }, selected: none, module: none,
    params: { value: {} }, macros: { value: {} }, automation: { value: { macro1: 2 } },
    tagged: (tag: string) => rig.groups.filter((g) => g.tags?.includes(tag)).map((g) => g.id) };
  const at = (x: TourView | null): Ctx => ({ v: x, page: '/studio', el: () => null });
  return [...s.anchor(at(null)), ...s.anchor(at(v as unknown as TourView))];
}

/** Why a name a step points at is not in the app, or null. */
function missing(name: string, layers: string[], kinds: string[]) {
  const [prefix, part] = name.includes(':') ? [name.slice(0, name.indexOf(':') + 1), name.slice(name.indexOf(':') + 1)]
    : [name, ''];
  if (!part) {
    if (written.has(name)) return null;
    // the layer pane's icons are named by their labels, tourName'd
    return source.includes('data-tour={tourName(label)}') && new RegExp(`icon\\('${name.replace(/-/g, ' ')}'`, 'i')
      .test(source) ? null : `no data-tour="${name}" in public/js/ui`;
  }
  if (!filled.has(prefix)) return `no data-tour={\`${prefix}\${…}\`} in public/js/ui`;
  const ok: Record<string, (p: string) => boolean> = {
    'nav:': (p) => routes.includes(`/${p}`), 'view:': (p) => p === 'fit' || p in (rig.views ?? {}),
    'dock:': (p) => docks.includes(p),
    'shelf-tab:': (p) => kinds.includes(p), 'shelf:': (p) => modules.has(p) || presets.has(p),
    'module:': (p) => modules.has(p), 'module-on:': (p) => modules.has(p), 'module-grip:': (p) => modules.has(p),
    'group:': (p) => rig.groups.some((g) => g.id === p),
    'param:': (p) => [...modules.keys()].some((m) => p in paramsOf(m)),
    'layer:': (p) => layers.includes(p), 'mute:': (p) => layers.includes(p), 'solo:': (p) => layers.includes(p),
    'blend:': (p) => layers.includes(p), 'level:': (p) => layers.includes(p),
    'layer-grip:': (p) => layers.includes(p), 'lane:': (p) => /^\w+$/.test(p),
  };
  if (!ok[prefix]) return `no check for ${prefix} names: add one here`;
  return ok[prefix](part) ? null : `${prefix} has nothing called "${part}"`;
}

describe('the tutorial matches the app', () => {
  const kinds = [...new Set([...library.map((e) => e.kind || 'source'), 'blank'])];   // the shelf's Blank tab too
  for (const p of PATHS) {
    test(`${p.title}: every control, name and page a step uses exists`, () => {
      const made = layersOf(p), layers = made.map((l) => tourName(l.title));
      for (const s of p.steps) {
        for (const a of [...anchors(s, made), ...s.area ? [s.area] : []]) {
          assert.equal(missing(a, layers, kinds), null, `${p.id}/${s.id}: ${a}`);
        }
        for (const [, kind, name, key] of s.text.matchAll(/\{(preset|module|param):([a-z0-9-]+)(?:\.(\w+))?\}/g)) {
          const where = `${p.id}/${s.id}: {${kind}:${name}${key ? `.${key}` : ''}}`;
          if (kind === 'preset') assert.ok(presets.has(name), where);
          else assert.ok(modules.has(name), where);
          if (kind === 'param') assert.ok(paramsOf(name)[key]?.label, `${where}: no such param, or no label`);
        }
        if (s.page) assert.ok(routes.includes(s.page), `${p.id}/${s.id}: page ${s.page}`);
      }
      assert.ok(routes.includes(p.start.split('?')[0]), `${p.id}: starts at ${p.start}`);
      assert.equal(new Set(p.steps.map((s) => s.id)).size, p.steps.length, `${p.id}: step ids are unique`);
    });
  }

  test('each path that starts on a practice look has one, made from the library, that saves as a look', () => {
    const wanted = PATHS.flatMap((p) => [p.start, p.look ?? ''])
      .map((at) => new URLSearchParams(at.split('?')[1]).get('tour')).filter(Boolean);
    assert.deepEqual([...recipes.keys()].sort(), [...wanted].sort());
    for (const [id, r] of recipes) {
      const look = practiceLook(r, library, rig);
      assert.ok(look, `${id}: a module or palette it names is not in the library`);
      const saved = LookCreate.safeParse(look);
      assert.ok(saved.success, `${id}: ${saved.error?.message}`);
      assert.equal(look.id, undefined, `${id}: never one of the person's looks`);
    }
  });

  test('a step that waits on a rig tag finds it on the rig', () => {
    for (const tag of ['rose', 'arch-main', 'arch-mini']) {
      assert.ok(rig.groups.some((g) => g.tags?.includes(tag)), `Rose and arches plays on the groups tagged ${tag}`);
    }
  });
});
