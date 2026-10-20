// Rotate: turns what is above it by Angle, and on round at Spin turns a second, in a Plane: the façade (and the
// angle round its centre with it), the side (depth and height) or plan (from above).
const params = {
  plane: { value: 'facade', type: 'choice', options: ['facade', 'side', 'plan'], label: 'Plane',
    help: 'Facade turns the front view round its centre; side tips depth against height; plan turns it from above.' },
  angle: { value: 0.125, min: -0.5, max: 0.5, step: 0.005, label: 'Angle (turns)',
    help: 'A fixed tilt. 0 leaves it upright; 0.25 is a quarter turn; negative turns the other way.' },
  spin: { value: 0, min: -1, max: 1, step: 0.01, label: 'Spin (turns a second)',
    help: 'Keeps it turning on top of Angle. 0 holds still; higher spins faster; negative spins the other way.' },
};

function warp(q, t, P) {
  const turn = P.angle + clock('spin'), s = sin(TAU * turn), c = cos(TAU * turn);
  if (P.plane === 'facade') {
    const dz = q.lz - 0.5, dy = q.ly - 0.5;
    move(q, q.lx, 0.5 + dz * s + dy * c, 0.5 + dz * c - dy * s);
  } else {
    const dx = q.lx - 0.5, d2 = P.plane === 'side' ? q.ly - 0.5 : q.lz - 0.5;
    const x = 0.5 + dx * c - d2 * s, y = 0.5 + dx * s + d2 * c;
    if (P.plane === 'side') move(q, x, y, q.lz); else move(q, x, q.ly, y);
  }
}
