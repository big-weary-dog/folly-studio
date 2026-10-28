// What a model is shown of the frames it made (SPEC-generators "Critique"): the LEDs seen from the front (z across, y
// up, the back drawn first) at a few times, as small PNGs, and 30 lines across the frames (none closer than 0.5 s)
// with each top-level group's mean colour and brightness, for models that read text only (and each one's mean over
// them, for the critique's warnings); and close-ups of the groups `closeUps` names (frames-closeup.ts).
// Works on baked bytes from the render box; runs no look code.

import { encodePng as png } from '../png.ts';

import { type Light, ledLight, pixelsForGroups, prepareScene } from '../../public/js/pattern-core.ts';
import type { Rig } from '../../shared/schemas/rig.ts';
import { frameOffsets, parseFseq } from '../frames.ts';
import { inflateBlock } from '../fseq-codec.ts';
import { cellsOf, drawCloseUp } from './frames-closeup.ts';

const WIDTH = 360;

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16)
  .padStart(2, '0')).join('')}`;

/**
 * Baked frames → { stills: PNG per time in `at` (seconds), closeUps: PNG per group in `closeUps` and time, timeline:
 * text, 30 lines across the frames, groups: each top-level group's mean brightness over those lines (0–1) }. Throws
 * when the bytes are not frames of this rig. Brightness is the LEDs' light, by `light` (the settings; the defaults
 * without).
 */
export function viewFrames(bytes: Uint8Array, rig: Rig, { at = [1, 4.3, 7.6], stills = true,
  closeUps = [] as readonly string[], light = undefined as Light | undefined } = {}) {
  const scene = prepareScene(rig);
  const parsed = parseFseq(bytes, { maxChannels: scene.frameChannels, decompress: inflateBlock });
  const [oR, oG, oB] = frameOffsets(parsed, scene);
  const { data, channelCount: cc, frameCount: F, stepMs } = parsed, N = scene.count;
  const frameAt = (s: number) => Math.min(F - 1, Math.max(0, Math.round((s * 1000) / stepMs)));
  const rgb = (f: number, k: number) => [oR, oG, oB].map((o) => (o[k]! >= 0 ? data[f * cc + o[k]!]! : 0));
  const { min, max } = scene.bounds, spanZ = max[2]! - min[2]! || 1, spanY = max[1]! - min[1]! || 1;
  const W = WIDTH, H = Math.max(40, Math.min(WIDTH, Math.round((W * spanY) / spanZ)));
  const order = [...Array(N).keys()].sort((a, b) => scene.X[b]! - scene.X[a]!); // the back first, the front on top
  const pictures = !stills ? [] : at.map((s) => {
    const img = new Uint8Array(W * H * 3), f = frameAt(s);
    for (const k of order) {
      const x = 1 + Math.round(((scene.Z[k]! - min[2]!) / spanZ) * (W - 3));
      const y = H - 2 - Math.round(((scene.Y[k]! - min[1]!) / spanY) * (H - 3));
      const c = rgb(f, k);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((y + dy) * W + x + dx) * 3;
          for (let ch = 0; ch < 3; ch++) img[i + ch] = Math.max(img[i + ch]!, c[ch]!);
        }
      }
    }
    return { at: s, png: png(W, H, img) };
  });
  const near = !stills ? [] : closeUps.flatMap((group) => {
    const cells = cellsOf(rig, scene, group);
    return at.map((s) => {
      const f = frameAt(s), c = drawCloseUp(cells, (k) => rgb(f, k));
      return { at: s, group, png: png(c.width, c.height, c.rgb) };
    });
  });
  // The root's children (or the root), each a mean colour and brightness (0–100 % of white, in the LEDs' light).
  const tops = scene.groups.filter((g) => g.parent === scene.root?.id);
  const parts = (tops.length ? tops : scene.root ? [scene.root] : []).slice(0, 8)
    .map((g) => ({ id: g.id, px: pixelsForGroups(scene, g.id) })).filter((p) => p.px.length);
  const lines: string[] = [], span = (F * stepMs) / 1000, step = Math.max(0.5, span / 30), means = parts.map(() => 0);
  const table = ledLight(light);
  const count = Math.max(1, Math.floor(span / step));
  for (let n = 0; n < count; n++) {
    const f = frameAt((n + 0.5) * step);
    lines.push(`${+(n * step).toFixed(1)}s ${parts.map(({ id, px }, i) => {
      const sum = [0, 0, 0];
      let lit = 0;
      for (const k of px) rgb(f, k).forEach((v, ch) => { sum[ch]! += v; lit += table[256 * ch + v]!; });
      const [r, g, b] = sum.map((v) => v / px.length) as [number, number, number];
      means[i]! += lit / (3 * px.length) / count;
      return `${id} ${hex(r, g, b)} ${Math.round((lit / (3 * px.length)) * 100)}%`;
    }).join(', ')}`);
  }
  return { stills: pictures, closeUps: near, timeline: lines.join('\n'),
    groups: parts.map((p, i) => ({ id: p.id, mean: means[i]! })) };
}
