// Kaleidoscope: cuts what is above it into mirrored wedges round the layer's centre, turning at Spin.
const params = {
  segments: { value: 6, min: 2, max: 16, step: 1, label: 'Wedges',
    help: 'How many mirrored slices make up the circle. Few gives broad, simple folds; many gives a busy star.' },
  spin: { value: 0.02, min: -0.5, max: 0.5, step: 0.01, label: 'Spin (turns a second)',
    help: 'How fast the pattern turns inside the wedges. Zero holds still; negative turns the other way.' },
};

// The angle folded into the first wedge, mirrored back and forth.
function warp(q, t, P) {
  const seg = 1 / max(2, round(P.segments));
  const f = fract((q.a + clock('spin')) / seg);
  turn(q, (f < 0.5 ? f : 1 - f) * seg, q.r);
}
