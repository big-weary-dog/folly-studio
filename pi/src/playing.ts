// A prepared look's rendering and public source, shared by both sides of a crossfade.
import { renderFrame, type PreparedLayer, type Scene } from '../../public/js/pattern-core.ts';
import type { PiSource } from '../../shared/schemas/live.ts';
import type { Layer } from '../../shared/schemas/look.ts';
import type { Baked } from './baked.ts';
import type { LiveLook } from './controls.ts';
import type { PiLook } from './library.ts';
import type { Item } from './engine.ts';

export type Playing = { item: Item, id: string, title: string, duration: number, look: PiLook | null,
  live: LiveLook | null, layers: PreparedLayer[], baked: Baked | null };

export function renderPlaying(p: Playing, scene: Scene, frame: number, dt: number, rgb: Float32Array) {
  const t = frame * dt;
  if (p.baked) { p.baked.fill(frame, rgb); return null; }
  p.live!.step(t, dt);
  return renderFrame(scene, p.layers, t, rgb, p.live!.look).errors[0]?.error;
}

export function playingSource(p: Playing, rev: number): PiSource {
  const { id, title, duration, look, live } = p;
  if (!look || !live) return { rev, id, title, duration, globals: null, automation: null, layers: [], baked: true };
  const layers = live.layers().map((l) => ({ ...l, modules: (l.modules ?? []).map(({ code: _, ...m }) => m) }));
  const palette = live.paletteHex(), globals = palette ? { ...look.globals!, palette } : look.globals ?? null;
  return { rev, id, title, duration, ...(look.bpm ? { bpm: look.bpm } : {}), globals,
    automation: live.automation, layers: layers as Layer[] };
}
