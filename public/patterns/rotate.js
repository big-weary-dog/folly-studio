// Rotate: turns lz and ly about the layer's centre (and the angle a with them) by `angle` turns, plus `spin`
// turns a second, so anything drawn across the layer or round it rotates.
const params = {
  angle: { value: 0.125, min: -0.5, max: 0.5, step: 0.005, label: 'Angle (turns)' },
  spin: { value: 0, min: -1, max: 1, step: 0.01, label: 'Turns a second' },
};

function warp(q, t, P) {
  const turn = P.angle + t * P.spin;
  const s = sin(TAU * turn), c = cos(TAU * turn);
  const dz = q.lz - 0.5, dy = q.ly - 0.5;
  q.lz = 0.5 + dz * c - dy * s;
  q.ly = 0.5 + dz * s + dy * c;
  q.a = fract(q.a + turn);
}
