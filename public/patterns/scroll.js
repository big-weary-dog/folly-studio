// Scroll: slides the layer steadily, across, up, front to back or along every strand, wrapping round.
//
// Each speed is in layer-widths (or strand lengths) a second. Scrolling along strands moves u and
// i together, so chases and meteors drawn after it drift along their wires.
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
