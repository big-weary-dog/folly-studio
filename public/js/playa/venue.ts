// Venue props (SPEC "Venue"): unlit scenery round the rig from data/venue.json, drawn dim in both views. Never LEDs:
// nothing but the view reads them. Boxes, flat-shaded per face (a face list makes a plane: a wall shows only its
// courtyard side, so a camera outside sees through it), a facade's windows drawn in the shader, and railings.
import { program } from '../viewer-gl.ts';

type V3 = [number, number, number];
type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
type Windows = { bay: number; storey: number; size: [number, number]; from: number; rows: number; lit: number };
export type Venue = {
  venue: 1; rig: string; about?: string;
  boxes?: { id: string; min: V3; max: V3; color: V3; faces?: Face[]; windows?: Windows; ground?: boolean }[];
  rails?: { id: string; from: V3; to: V3; height: number; posts: number; color: V3 }[];
};
export type VenueGL = ReturnType<typeof createVenue>;

/** Floats a vertex: position 3, colour 3, facade uv 2 (metres), windows 4 (bay, storey, width, height) and 2
 * (rows, lit). */
export const STRIDE = 14;
const FACES: Record<Face, V3> = { front: [-1, 0, 0], back: [1, 0, 0], left: [0, 0, -1], right: [0, 0, 1],
  top: [0, 1, 0], bottom: [0, -1, 0] };
const RAIL = 0.025, POST = 0.03;      // half thicknesses, metres
const NO_WINDOWS = [0, 0, 0, 0, 0, 0];

const add = (a: number[], b: number[], k = 1) => a.map((x, i) => x + k * b[i]);
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const unit = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
// Unlit, but each face a shade so the boxes read: tops brightest, the long sides darkest.
const shade = (n: number[]) => (n[1] > 0.5 ? 1 : n[1] < -0.5 ? 0.4 : Math.abs(n[0]) > 0.5 ? 0.8 : 0.62);

/** A cuboid round centre c with right-handed half-axes a (one may be 0: a plane): each face kept by keep(normal) as
 * two triangles wound outward; a face of no area has no normal, so is never kept. */
function cuboid(out: number[], c: number[], a: number[][], color: V3, keep: (n: number[]) => boolean,
  facade?: { min: number[]; w: Windows }) {
  for (let i = 0; i < 3; i++) {
    for (const s of [1, -1]) {
      const [j, k] = [(i + 1) % 3, (i + 2) % 3], n = unit(cross(a[j], a[k])).map((x) => s * x);
      if (!keep(n)) continue;
      const m = add(c, a[i], s), q = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
        .map(([u, v]) => add(add(m, a[j], u), a[k], v));
      if (dot(cross(add(q[1], q[0], -1), add(q[3], q[0], -1)), n) < 0) q.reverse();
      const col = color.map((x) => x * shade(n)), along = Math.abs(n[2]) > 0.5 ? 0 : 2;
      for (const p of [q[0], q[1], q[2], q[0], q[2], q[3]]) {
        const f = facade, uv = f ? [p[along] - f.min[along], p[1] - f.min[1] - f.w.from] : [0, 0];
        out.push(...p, ...col, ...uv, ...(f ? [f.w.bay, f.w.storey, ...f.w.size, f.w.rows, f.w.lit] : NO_WINDOWS));
      }
    }
  }
}

/** The props as triangles in the view frame (STRIDE floats a vertex): `solid` vertices, then the ground's. T maps the
 * rig's axes onto it. */
export function venueMesh(venue: Venue, T: (p: ArrayLike<number>) => number[]) {
  const out: number[] = [], boxes = venue.boxes || [];
  const box = (b: (typeof boxes)[number]) => {
    const [p, q] = [T(b.min), T(b.max)], min = p.map((x, i) => Math.min(x, q[i]));
    const half = p.map((x, i) => Math.abs(x - q[i]) / 2);
    const named = (b.faces || Object.keys(FACES) as Face[]).map((f) => FACES[f]);
    const keep = (n: number[]) => named.some((f) => dot(f, n) > 0.99);
    cuboid(out, add(min, half), [[half[0], 0, 0], [0, half[1], 0], [0, 0, half[2]]], b.color, keep,
      b.windows && { min, w: b.windows });
  };
  boxes.filter((b) => !b.ground).forEach(box);
  for (const r of venue.rails || []) {
    const from = T(r.from), d = add(T(r.to), from, -1), len = Math.hypot(...d);
    if (!len) continue;
    const u = unit(d), side = unit(cross(u, [0, 1, 0])), all = () => true;
    for (const h of [r.height, r.height / 2]) {
      cuboid(out, add(add(from, d, 0.5), [0, h, 0]), [u.map((x) => x * len / 2), [0, RAIL, 0],
        side.map((x) => x * RAIL)], r.color, all);
    }
    for (let t = 0; t <= len + 1e-6; t += r.posts) {
      cuboid(out, add(add(from, u, t), [0, r.height / 2, 0]), [u.map((x) => x * POST), [0, r.height / 2, 0],
        side.map((x) => x * POST)], r.color, all);
    }
  }
  const solid = out.length / STRIDE;
  boxes.filter((b) => b.ground).forEach(box);
  return { mesh: new Float32Array(out), solid };
}

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aP;
layout(location=1) in vec3 aC;
layout(location=2) in vec2 aU;
layout(location=3) in vec4 aW;
layout(location=4) in vec2 aR;
uniform mat4 uVP;
out vec3 vC, vP;
out vec2 vU;
flat out vec4 vW;
flat out vec2 vR;
void main() {
  vC = aC; vP = aP; vU = aU; vW = aW; vR = aR;
  gl_Position = uVP * vec4(aP, 1);
}`;

// A facade: a window centred in each bay of each storey from the first row up, its panes split by muntins, some
// warm-lit (by a hash of the window: steady), the rest dark glass. Then the haze, by distance from the eye.
const FS = `#version 300 es
precision highp float;
in vec3 vC, vP;
in vec2 vU;
flat in vec4 vW;
flat in vec2 vR;
uniform vec3 uE, uFog;
uniform float uK;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = vC;
  if (vW.x > 0.) {
    vec2 cell = floor(vU / vW.xy), f = vU - cell * vW.xy - (vW.xy - vW.zw) * .5;
    if (cell.y >= 0. && cell.y < vR.x && all(greaterThan(f, vec2(0))) && all(lessThan(f, vW.zw))) {
      vec2 pane = abs(fract(f / vec2(.68, .65)) - .5);
      vec3 lit = vec3(1., .62, .26) * (.08 + .07 * hash(cell + 7.)), dark = vec3(.006, .008, .014);
      c = mix(c * .7, hash(cell) < vR.y ? lit : dark, step(max(pane.x, pane.y), .44));
    }
  }
  o = vec4(mix(c * uK, uFog, 1. - exp(-length(vP - uE) * .008)), 1);
}`;

/** The props on the GPU. draw() leaves depth to the caller and culls back faces while it draws. */
export function createVenue(gl: WebGL2RenderingContext, { mesh, solid }: ReturnType<typeof venueMesh>) {
  const { p, u } = program(gl, VS, FS), vao = gl.createVertexArray(), buf = gl.createBuffer(), n = mesh.length / STRIDE;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  [3, 3, 2, 4, 2].reduce((off, k, i) => {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, k, gl.FLOAT, false, 4 * STRIDE, off);
    return off + 4 * k;
  }, 0);
  gl.bindVertexArray(null);
  return {
    /** k: the props' gain in this view; fog: what they fade to far off. lit: the view's ground is lit, so the
     * venue's ground tints it (added, fading out far off) rather than hiding its light. */
    draw(viewProj: Float32Array, eye: number[], k: number, fog: number[], lit = false) {
      gl.useProgram(p);
      gl.uniformMatrix4fv(u.uVP, false, viewProj);
      gl.uniform3fv(u.uE, eye);
      gl.uniform3fv(u.uFog, fog);
      gl.uniform1f(u.uK, k);
      gl.enable(gl.CULL_FACE);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, lit ? solid : n);
      if (lit && n > solid) {
        gl.uniform3f(u.uFog, 0, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.depthMask(false);
        gl.drawArrays(gl.TRIANGLES, solid, n - solid);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.CULL_FACE);
    },
    destroy() {
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(p);
    },
  };
}
