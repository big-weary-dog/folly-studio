// Twist: swirls what is above it round the layer's centre, more toward the rim, turning at Spin; and winds depth
// round height, so towers and spires spiral. All in turns.
const params = {
  swirl: { value: 0.25, min: -1, max: 1, step: 0.01, label: 'Swirl (turns at the rim)' },
  wind: { value: 0, min: -1, max: 1, step: 0.01, label: 'Wind with height (turns)' },
  spin: { value: 0.05, min: -0.5, max: 0.5, step: 0.01, label: 'Spin (turns a second)' },
};

function warp(q, t, P) {
  if (P.swirl || P.spin) turn(q, q.a + P.swirl * q.r + clock('spin'), q.r);
  if (P.wind) {
    const w = TAU * P.wind * q.ly, s = sin(w), c = cos(w);
    const dz = q.lz - 0.5, dx = q.lx - 0.5;
    move(q, 0.5 + dz * s + dx * c, q.ly, 0.5 + dz * c - dx * s);
  }
}
