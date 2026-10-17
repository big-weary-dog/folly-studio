// Twist: swirls the angle by an amount growing with the radius (a whirlpool, turning `spin` a second) and
// winds depth round height (`wind`), so towers and spires spiral. Both in turns.
const params = {
  swirl: { value: 0.25, min: -1, max: 1, step: 0.01, label: 'Swirl (turns at the rim)' },
  wind: { value: 0, min: -1, max: 1, step: 0.01, label: 'Wind with height (turns)' },
  spin: { value: 0.05, min: -0.5, max: 0.5, step: 0.01, label: 'Turns a second' },
};

function warp(q, t, P) {
  if (P.swirl || P.spin) {
    const a = fract(q.a + P.swirl * q.r + t * P.spin);
    q.a = a;
    q.lz = 0.5 + 0.5 * q.r * sin(TAU * a);
    q.ly = 0.5 + 0.5 * q.r * cos(TAU * a);
  }
  if (P.wind) {
    const turn = TAU * P.wind * q.ly, s = sin(turn), c = cos(turn);
    const dz = q.lz - 0.5, dx = q.lx - 0.5;
    q.lz = 0.5 + dz * c - dx * s;
    q.lx = 0.5 + dz * s + dx * c;
  }
}
