// A path's practice look (SPEC-tutorial): public/data/tutorial/<path>.json names library presets, and their layers,
// stacked bottom first, make a look with no id, so Save makes the person's own copy and nothing of theirs changes.
import type { Look } from '../../../../shared/schemas/api.ts';
import type { LibraryEntry, PresetEntry, Rig } from '../../../../shared/schemas/rig.ts';
import { isPreset, presetLayers, withPresetGlobals } from '../model.ts';

/** `bpm` when the path needs a tempo other than the default 120. */
export type Recipe = { title: string; presets: string[]; bpm?: number };

/** The look a recipe makes from the library, or null when the library lacks one of its presets. */
export function practiceLook(r: Recipe, library: LibraryEntry[], rig: Rig | null): Look | null {
  const presets = r.presets.map((name) => library.find((e): e is PresetEntry => e.name === name && isPreset(e)));
  if (!presets.length) return null;
  let globals: Look['globals'];
  const layers = [];
  for (const p of presets) {
    if (!p) return null;
    const made = presetLayers(p, library, rig);
    if (!made) return null;
    layers.push(...made);
    globals = withPresetGlobals(globals, p);
  }
  const look = { title: r.title, summary: '', layers, ...(globals ? { globals } : {}) };
  return (r.bpm ? { ...look, bpm: r.bpm } : look) as Look;
}

const RECIPES = import.meta.glob<Recipe>('../../../data/tutorial/*.json', { import: 'default' });
/** `?tour=<path>`'s look; null (a new look) when there is no such path or the library lacks its presets. */
export async function loadPractice(path: string, library: LibraryEntry[], rig: Rig | null) {
  const load = RECIPES[`../../../data/tutorial/${path}.json`];
  return load ? practiceLook(await load(), library, rig) : null;
}
