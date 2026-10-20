// Delay: each LED shows what is above it a little later than the one before it, along Direction, up to Longest
// seconds at the far side, so a flash sweeps across the rig and anything random replays late in another place. Steps
// snaps the lateness into blocks; Bounce runs it out and back (latest in the middle). It reads the core's frame
// buffer (past()), so time going back starts it again. A stage end: it keeps real LED colours from frame to frame.
const stage = 'history';
const history = 4;
const params = {
  direction: { value: 'up', type: 'choice', options: DIRECTIONS, label: 'Direction',
    help: 'Which way the lateness runs: up, across, front to back, out from the centre, along each strand, by petal.' },
  longest: { value: 0.5, min: 0, max: 4, step: 0.01, label: 'Longest (seconds)',
    help: 'How late the far side is. 0 is no delay; 0.2–0.6 sweeps a flash across; 2 or more smears motion.' },
  steps: { value: 0, min: 0, max: 16, step: 1, label: 'Steps',
    help: 'Snaps the lateness into this many steps, so groups go in blocks. 0 is smooth.' },
  bounce: { value: 0, min: 0, max: 1, step: 0.01, label: 'Bounce',
    help: 'Runs the lateness out and back, latest in the middle. 0 runs one way; 1 is fully out and back.' },
};

function filter(c, q, t, P) {
  const u = toward(q, P.direction), b = u + (1 - abs(2 * u - 1) - u) * P.bounce;
  return past(P.longest * (P.steps > 0 ? round(b * P.steps) / P.steps : b));
}
