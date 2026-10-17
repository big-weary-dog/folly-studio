// Kaleidoscope: folds the angle a into `segments` mirrored wedges round the layer's centre, turning `spin`
// turns a second; lz and ly are rebuilt from the folded angle and r, so sources drawn across repeat too.
const params = {
  segments: { value: 6, min: 2, max: 16, step: 1, label: 'Wedges' },
  spin: { value: 0.02, min: -0.5, max: 0.5, step: 0.01, label: 'Turns a second' },
};

function warp(q, t, P) {
  const seg = 1 / max(2, round(P.segments));
  const f = fract((q.a + t * P.spin) / seg);
  const a = (f < 0.5 ? f : 1 - f) * seg;          // within the first wedge, mirrored back and forth
  q.a = a;
  q.lz = 0.5 + 0.5 * q.r * sin(TAU * a);
  q.ly = 0.5 + 0.5 * q.r * cos(TAU * a);
}
