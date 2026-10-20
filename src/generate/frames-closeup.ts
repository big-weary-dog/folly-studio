// Close-ups for the critique (SPEC-generators "Critique"): a look whose layers play on the rose, or anchor on it, is
// also shown each rose (a group tagged `rose`) up close, from the front, each LED drawn as its fixture's glass cell
// (the rig's `render.cells`) or, without cells, as a dot sized to the LEDs' spacing. Runs no look code.

import { groupsByTag, pixelsForGroups, type prepareScene } from '../../public/js/pattern-core.ts';
import type { Rig } from '../../shared/schemas/rig.ts';

type Scene = ReturnType<typeof prepareScene>;
type Layer = { groups?: readonly string[], tags?: readonly string[] | null,
  modules?: readonly { params?: Record<string, unknown> }[] };
const TAG = 'rose', SIZE = 240;

/** The roses the look plays on: a layer with most of its LEDs in one, or a module naming the tag (anchor, centres). */
export function closeUpGroups(look: { layers?: readonly Layer[] }, scene: Scene): string[] {
  const roses = groupsByTag(scene, TAG);
  const named = (look.layers ?? []).some((l) => l.modules?.some((m) => Object.values(m.params ?? {}).includes(TAG)));
  return roses.filter((g) => {
    if (named) return true;
    const mine = new Set(pixelsForGroups(scene, g.id));
    return (look.layers ?? []).some((l) => {
      let px: Int32Array;
      try { px = pixelsForGroups(scene, l.groups ?? [], l.tags ?? undefined); } catch { return false; }
      let inside = 0;
      for (const k of px) if (mine.has(k)) inside++;
      return inside > 0 && inside >= px.length / 2;
    });
  }).map((g) => g.id);
}

/** Each LED of the group as a polygon in the front view (z across, y up): its cell, or a small square. */
export function cellsOf(rig: Rig, scene: Scene, id: string) {
  const leds = pixelsForGroups(scene, id), at = new Map<number, number[]>();
  for (const f of rig.fixtures) {
    const cells = f.render?.cells;
    if (!Array.isArray(cells)) continue;
    cells.forEach((c, i) => {
      if (Array.isArray(c) && c.length >= 9) at.set(f.start + i, c.flatMap((v, j) => (j % 3 ? [v as number] : [])));
    });
  }
  let near = Infinity;   // without cells: half the distance to the nearest neighbour
  if (leds.some((k) => !at.has(k))) {
    for (const a of leds) {
      for (const b of leds) {
        if (a !== b) near = Math.min(near, Math.hypot(scene.Z[a]! - scene.Z[b]!, scene.Y[a]! - scene.Y[b]!));
      }
    }
  }
  const h = Number.isFinite(near) ? near / 2 : 0.05;
  return [...leds].map((k) => ({ k, poly: at.get(k) ?? [scene.Y[k]! - h, scene.Z[k]! - h, scene.Y[k]! - h,
    scene.Z[k]! + h, scene.Y[k]! + h, scene.Z[k]! + h, scene.Y[k]! + h, scene.Z[k]! - h] }));
}

/** The close-up as SIZE × SIZE RGB bytes: the group's cells filled with colour(k), on black, framed to fit. */
export function drawCloseUp(cells: ReturnType<typeof cellsOf>, colour: (k: number) => number[]) {
  const img = new Uint8Array(SIZE * SIZE * 3);
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const { poly } of cells) {
    for (let i = 0; i < poly.length; i += 2) {
      y0 = Math.min(y0, poly[i]!); y1 = Math.max(y1, poly[i]!); z0 = Math.min(z0, poly[i + 1]!);
      z1 = Math.max(z1, poly[i + 1]!);
    }
  }
  const scale = (SIZE - 8) / Math.max(y1 - y0, z1 - z0, 1e-6), oz = (SIZE - (z1 - z0) * scale) / 2;
  const oy = (SIZE - (y1 - y0) * scale) / 2;
  for (const { k, poly } of cells) {
    const xs = [], ys = [];
    for (let i = 0; i < poly.length; i += 2) {
      xs.push(oz + (poly[i + 1]! - z0) * scale);
      ys.push(SIZE - oy - (poly[i]! - y0) * scale);
    }
    const c = colour(k), n = xs.length;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(SIZE - 1, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(SIZE - 1, Math.ceil(Math.max(...xs))); x++) {
        let inside = false;   // even-odd rule at the pixel's centre
        for (let i = 0, j = n - 1; i < n; j = i++) {
          if ((ys[i]! > y + 0.5) !== (ys[j]! > y + 0.5)
            && x + 0.5 < ((xs[j]! - xs[i]!) * (y + 0.5 - ys[i]!)) / (ys[j]! - ys[i]!) + xs[i]!) inside = !inside;
        }
        if (inside) img.set(c.slice(0, 3), (y * SIZE + x) * 3);
      }
    }
  }
  return { width: SIZE, height: SIZE, rgb: img };
}
