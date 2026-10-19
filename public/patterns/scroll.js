// Scroll: slides what is above it in Direction at Speed, wrapping round: across, up, front to back, round, out from
// the centre, or along every strand (so chases above it drift along their wires).
const params = {
  direction: { value: 'right', type: 'choice', options: DIRECTIONS, label: 'Direction' },
  speed: { value: 0.1, min: -2, max: 2, step: 0.01, label: 'Speed (layers a second)' },
};

function warp(q, t, P) {
  const d = P.direction, s = d === 'down' || d === 'left' || d === 'front' || d === 'in' ? -clock('speed')
    : clock('speed');
  if (d === 'right' || d === 'left') q.lz = fract(q.lz - s);
  else if (d === 'back' || d === 'front') q.lx = fract(q.lx - s);
  else if (d === 'out' || d === 'in') q.r = fract(q.r - s);
  else if (d === 'round') q.a = fract(q.a - s);
  else if (d === 'along') {
    q.u = fract(q.u - s);
    q.i = round(q.u * (q.n - 1));
  } else q.ly = fract(q.ly - s);
}
