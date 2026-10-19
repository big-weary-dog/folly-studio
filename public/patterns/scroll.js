// Scroll: slides the layer, wrapping round: across, up, front to back (layer widths a second) or along every
// strand (u and i together, so chases above it drift along their wires).
const params = {
  across: { value: 0.1, min: -2, max: 2, step: 0.01, label: 'Left → right' },
  up: { value: 0, min: -2, max: 2, step: 0.01, label: 'Upward' },
  depth: { value: 0, min: -2, max: 2, step: 0.01, label: 'Front → back' },
  along: { value: 0, min: -2, max: 2, step: 0.01, label: 'Along strands' },
};

function warp(q, t, P) {
  if (P.across) q.lz = fract(q.lz - t * P.across);
  if (P.up) q.ly = fract(q.ly - t * P.up);
  if (P.depth) q.lx = fract(q.lx - t * P.depth);
  if (P.along) {
    q.u = fract(q.u - t * P.along);
    q.i = round(q.u * (q.n - 1));
  }
}
