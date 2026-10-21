// A path's practice look (SPEC-tutorial): public/data/tutorial/<path>.json is the story so far, layers of library
// modules with their settings, stacked bottom first; it makes a look with no id, so Save makes the person's own copy
// and nothing of theirs changes.
import PALETTES from '../../../data/palettes.json' with { type: 'json' };
import type { Look } from '../../../../shared/schemas/api.ts';
import type { Globals } from '../../../../shared/schemas/look.ts';
import type { LibraryEntry, PresetEntry, PresetLayer, Rig } from '../../../../shared/schemas/rig.ts';
import { presetLayers } from '../model.ts';

type Clip = { start: number; end: number; fadeIn?: number; fadeOut?: number };
/** A layer as a preset writes it, plus where it plays (the groups carrying a rig tag) and its clips. */
export type RecipeLayer = PresetLayer & { tag?: string; clips?: Clip[] };
/** `palette` a name from data/palettes.json; `bpm` when not the default 120. */
export type Recipe = { title: string; layers: RecipeLayer[]; palette?: string; macros?: Globals['macros'];
  automation?: Look['automation']; bpm?: number };

/** The look a recipe makes from the library, or null when the library lacks one of its modules or palette. */
export function practiceLook(r: Recipe, library: LibraryEntry[], rig: Rig | null): Look | null {
  const made = presetLayers({ title: r.title, layers: r.layers } as PresetEntry, library, rig);
  if (!made) return null;
  const layers = made.map((l, i) => {
    const { tag, clips } = r.layers[i];
    const groups = tag && rig ? rig.groups.filter((g) => g.tags?.includes(tag)).map((g) => g.id) : null;
    const { tags: _tags, ...rest } = l;
    return { ...(groups ? { ...rest, groups } : l), ...(clips ? { clips } : {}) };
  });
  const found = r.palette ? PALETTES.palettes.find((p) => p.name === r.palette) : undefined;
  if (r.palette && !found) return null;
  const { theme: _theme, ...palette } = found ?? { theme: '' };   // a look stores the colours, not the theme
  const globals = { ...(found ? { palette } : {}),
    ...(r.macros ? { macros: r.macros } : {}) };
  return { title: r.title, summary: '', layers, ...(Object.keys(globals).length ? { globals } : {}),
    ...(r.automation ? { automation: r.automation } : {}), ...(r.bpm ? { bpm: r.bpm } : {}) } as Look;
}

const RECIPES = import.meta.glob<Recipe>('../../../data/tutorial/*.json', { import: 'default' });
/** `?tour=<path>`'s look; null (a new look) when there is no such path or the library lacks what it needs. */
export async function loadPractice(path: string, library: LibraryEntry[], rig: Rig | null) {
  const load = RECIPES[`../../../data/tutorial/${path}.json`];
  return load ? practiceLook(await load(), library, rig) : null;
}
