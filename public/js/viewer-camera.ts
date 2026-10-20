// The 3D view's camera maths, apart from the viewer's state: an orbit's basis, views.json views as orbits, and the
// view that frames the whole rig.

/** A camera as td/config/views.json and a rig's `views` give it. */
export type View = { Target?: number[]; Distance?: number; Angle?: number; Elevation?: number; Fov?: number;
  Eyelock?: boolean };
export type Cam = { target: number[]; distance: number; angle: number; elevation: number; fov: number };

export const DEG = Math.PI / 180;
const EYE_HEIGHT = 1.7;      // folly_view's default Eye Height for Eyelock views

/** Forward, right and up for an angle and elevation in degrees. */
export function basis(angle: number, elevation: number) {
  const a = angle * DEG, e = elevation * DEG;
  const fwd = [Math.cos(e) * Math.cos(a), -Math.sin(e), -Math.cos(e) * Math.sin(a)];
  const right = [Math.sin(a), 0, Math.cos(a)];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0]]; // right × forward
  return { fwd, right, up };
}

/** Views from views.json → orbit state. Eyelock views stand at eye height. */
export function viewToCam(v: View): Cam {
  const target = [...(v.Target || [0.9, 9.3, -0.4])];
  const d = v.Distance ?? 40, angle = v.Angle ?? 0, fov = v.Fov ?? 45;
  if (v.Eyelock) {
    const dy = EYE_HEIGHT - target[1];
    const flat = Math.sqrt(Math.max(d * d - dy * dy, 0.25));
    return { target, distance: Math.hypot(flat, dy), angle, elevation: Math.atan2(dy, flat) / DEG, fov };
  }
  return { target, distance: d, angle, elevation: v.Elevation ?? 0, fov };
}

/** A view aimed at the rig's middle with every LED inside a share (`sx`, `sy`) of a frame whose half-width and
 * half-height at a metre are `tanH` and `tanV`. */
export function fitView(P: Float32Array, b: { min: number[]; max: number[] }, tanH: number, tanV: number,
  sx: number, sy: number, angle: number, elevation: number, fov: number): View {
  const target = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
  const { fwd, right, up } = basis(angle, elevation);
  let d = 5;
  for (let i = 0; i < P.length; i += 3) {
    const ox = P[i] - target[0], oy = P[i + 1] - target[1], oz = P[i + 2] - target[2];
    const of = ox * fwd[0] + oy * fwd[1] + oz * fwd[2];
    const or = ox * right[0] + oz * right[2];
    const ou = ox * up[0] + oy * up[1] + oz * up[2];
    d = Math.max(d, Math.abs(or) / (sx * tanH) - of, Math.abs(ou) / (sy * tanV) - of);
  }
  return { Target: target, Distance: d * 1.06, Angle: angle, Elevation: elevation, Fov: fov, Eyelock: false };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** The part of a frame (`w` by `h` CSS px, `top` down the canvas) that `r` (CSS px of the canvas) leaves: in `out`,
 * its centre in the frame's NDC and its share of the frame's width and height; all of it when `r` is null. */
export function clearLens(r: { x: number; y: number; w: number; h: number } | null, w: number, top: number,
  h: number, out: number[]) {
  out[0] = out[1] = 0; out[2] = out[3] = 1;
  if (!r) return out;
  const x0 = clamp(r.x, 0, w), x1 = clamp(r.x + r.w, x0, w), y0 = clamp(r.y, top, top + h);
  const y1 = clamp(r.y + r.h, y0, top + h);
  out[0] = (x0 + x1) / w - 1; out[1] = 1 - (y0 + y1 - 2 * top) / h;
  out[2] = Math.max(0.05, (x1 - x0) / w); out[3] = Math.max(0.05, (y1 - y0) / h);
  return out;
}
