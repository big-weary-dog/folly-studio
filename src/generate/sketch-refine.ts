// sketch's refinements (SPEC-generators "Refine"): simple word edits on a look's composition. Faster or slower scales
// each pace param (by name, as sketch reads them); brighter or dimmer each layer's level; colour words choose the
// palette and set every colour pick; "only the <place>" moves every layer there (the rig's tags, as sketch finds
// places); "add <theme>" adds the layer sketch would make of the theme. Anything else it cannot do, and says so.

import { GenerateError } from '../../shared/schemas/generated.ts';
import type { LibraryEntry, RigGroup } from '../../shared/schemas/rig.ts';
import type { Catalog } from './catalog.ts';
import { type Composition, decompose } from './refine.ts';
import { choosePalette, pickFor } from './sketch-colours.ts';
import { colourOf, FAST, groupIndex, PACE, SLOW, sketchLook, words, zoneMentions } from './sketch.ts';

type Use = Composition['layers'][number]['modules'][number];
type Decl = NonNullable<ReturnType<Catalog['modules']['get']>>;
const MAX_LAYERS = 4;
const BRIGHTER = new Set(['brighter', 'bright', 'stronger', 'louder', 'bolder']);
const DIMMER = new Set(['dimmer', 'dim', 'darker', 'softer', 'subtler', 'fainter', 'quieter']);
const round = (x: number) => Math.round(x * 1000) / 1000;
/** "slower" → "slow", "quicker" → "quick": the comparative's root, when sketch knows it. */
const root = (w: string) => (w.endsWith('er') && (SLOW.has(w.slice(0, -2)) || FAST.has(w.slice(0, -2)))
  ? w.slice(0, -2) : w.endsWith('ier') ? `${w.slice(0, -3)}y` : w);

/** `comp` with the change `text` asks for; throws GenerateError when sketch knows none of its words. */
export function sketchRefine(comp: Composition, text: string, { library, groups, catalog }: {
  library: readonly LibraryEntry[], groups: readonly RigGroup[], catalog: Catalog }): Composition {
  const lower = String(text).toLowerCase().slice(0, 1000), ws = words(lower).map(({ w, at }) => ({ w: root(w), at }));
  const out: Composition = structuredClone(comp), done: string[] = [];
  const each = (fn: (m: Use, decl: Decl) => void) => out.layers.forEach((l) => l.modules.forEach((m) => {
    const decl = catalog.modules.get(m.use);
    if (decl) fn(m, decl);
  }));
  const set = (m: Use, name: string, value: unknown) => {
    const p = m.params.find((x) => x.name === name);
    if (p) p.value = value;
    else m.params.push({ name, value });
  };

  // "add a sparkle layer": sketch's own layer for the words after "add".
  const add = /\badd(?:\s+(?:a|an|some|the))?\s+([^.,;!?]+)/.exec(lower);
  if (add && out.layers.length < MAX_LAYERS) {
    const made = sketchLook({ text: add[1]!.replace(/\s+layers?\b/, ''), library, groups });
    const layer = made.layers.find((l) => 'modules' in l && l.modules.some((m) => m.ref));
    if (layer) {
      out.layers.push({ ...decompose({ layers: [layer] }, catalog).layers[0]!, blend: 'add', level: 0.8 });
      done.push('add');
    }
  }
  const rest = add ? lower.slice(0, add.index) : lower;

  const pace = ws.filter(({ at }) => !add || at < add.index).reduce((f, { w }) => (SLOW.has(w) ? f * 0.6
    : FAST.has(w) ? f * 1.6 : f), 1);
  if (pace !== 1) {
    each((m, decl) => {
      for (const [name, d] of Object.entries(decl.params)) {
        if (d.type !== 'number' || !PACE.test(name)) continue;
        const now = m.params.find((p) => p.name === name)?.value ?? d.value;
        if (typeof now === 'number') set(m, name, round(Math.min(d.max, Math.max(d.min, now * pace))));
      }
    });
    done.push('pace');
  }
  const level = ws.reduce((f, { w }) => (BRIGHTER.has(w) ? f * 1.4 : DIMMER.has(w) ? f * 0.6 : f), 1);
  if (level !== 1) {
    out.layers.forEach((l) => { l.level = round(Math.min(1, Math.max(0.05, Number(l.level ?? 1) * level))); });
    done.push('level');
  }
  const hexes = ws.filter(({ at }) => !add || at < add.index).map(({ w }) => colourOf(w)).filter(Boolean) as string[];
  const palette = choosePalette(hexes);
  if (hexes.length) {
    if (palette) out.globals = { ...out.globals, palette: palette.name };
    const pick = pickFor(hexes, palette);
    each((m, decl) => {
      for (const [name, d] of Object.entries(decl.params)) if (d.type === 'color') set(m, name, pick);
    });
    done.push('colour');
  }
  const only = /\bonly\b(.*)/.exec(rest);
  const places = only ? zoneMentions(only[1]!, groupIndex(groups)) : [];
  if (places.length) {
    const ids = [...new Set(places.flatMap((p) => p.ids))], tags = [...new Set(places.flatMap((p) => p.tags))];
    out.layers.forEach((l) => { l.groups = ids; l.tags = tags; });
    done.push('place');
  }
  if (!done.length) {
    throw new GenerateError('Sketch can\'t make that change; try another model.',
      `sketch refine: ${lower.slice(0, 80)}`);
  }
  return out;
}
