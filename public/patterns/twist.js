// Twist: swirls what is above it round the layer's centre, more toward the rim; and winds it round each tower's
// upright axis (the layer's middle with no towers), more the higher up, so towers spiral. All in turns.
const params = {
  swirl: { value: 0.25, min: -2, max: 2, step: 0.01, label: 'Swirl (turns at the rim)',
    help: 'How far the rim turns against the centre. 0 leaves it straight; more twists a spiral; negative reverses.' },
  wind: { value: 0, min: -4, max: 4, step: 0.01, label: 'Wind with height (turns)',
    help: 'Winds round each tower, more the higher up, so the towers spiral. 0 is off; negative winds back.' },
};

let towers = [];
const at = (d, h) => 0.5 + d / (2 * h || 1);       // metres from the frame's middle, back to its 0..1

function frame(t, P) { towers = centres('tower'); }

function warp(q, t, P) {
  if (P.swirl) turn(q, q.a + P.swirl * q.r, q.r);
  if (P.wind) {                                     // round the nearest tower's upright axis, in metres
    let cx = q.ox, cz = q.oz, best = Infinity;
    for (const k of towers) {
      const d = hypot(q.X - k[0], q.Z - k[2]);
      if (d < best) { best = d; cx = k[0]; cz = k[2]; }
    }
    const w = TAU * P.wind * q.ly, s = sin(w), c = cos(w), dz = q.Z - cz, dx = q.X - cx;
    move(q, at(cx + dz * s + dx * c - q.ox, q.sx), q.ly, at(cz + dz * c - dx * s - q.oz, q.sz));
  }
}
