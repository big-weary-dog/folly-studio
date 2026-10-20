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

const at = (d, h) => 0.5 + d / (2 * h || 1);       // metres from the frame's middle, back to its 0..1

function warp(q, t, P) {
  // Turned in metres round the frame's middle, so shapes keep their proportions on a layer that is not square.
  const turn = P.angle + clock('spin'), s = sin(TAU * turn), c = cos(TAU * turn), f = P.plane === 'facade';
  const side = P.plane === 'side', du = f ? q.Z - q.oz : q.X - q.ox, dv = f || side ? q.Y - q.oy : q.Z - q.oz;
  const u = du * c - dv * s, v = du * s + dv * c;
  if (f) move(q, q.lx, at(v, q.sy), at(u, q.sz));
  else if (side) move(q, at(u, q.sx), at(v, q.sy), q.lz);
  else move(q, at(u, q.sx), q.ly, at(v, q.sz));
}
