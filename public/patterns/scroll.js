// Scroll: slides what is above it in Direction at Speed, wrapping round: across, up, front to back, round, out from
// the centre, or along every strand (so chases above it drift along their wires).
const params = {
  direction: { value: 'right', type: 'choice', options: DIRECTIONS, label: 'Direction',
    help: 'Which way it slides: across, up, down, front to back, round, in or out, or along each strand.' },
  speed: { value: 0.1, min: -2, max: 2, step: 0.01, label: 'Speed (layers a second)',
    help: 'How fast it slides and wraps round. Near 0 creeps; high races; negative slides the opposite way.' },
};

function warp(q, t, P) {
  const d = P.direction, s = d === 'down' || d === 'left' || d === 'front' || d === 'in' ? -clock('speed')
    : clock('speed');
  if (d === 'right' || d === 'left') move(q, q.lx, q.ly, fract(q.lz - s));
  else if (d === 'back' || d === 'front') move(q, fract(q.lx - s), q.ly, q.lz);
  else if (d === 'out' || d === 'in') turn(q, q.a, fract(q.r - s));
  else if (d === 'round') turn(q, fract(q.a - s), q.r);
  else if (d === 'along') slide(q, fract(q.u - s));
  else move(q, q.lx, fract(q.ly - s), q.lz);
}
