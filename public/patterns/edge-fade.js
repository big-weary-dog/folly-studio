// Edge fade: fades what is above it out toward one edge of the layer, so it melts into what is below. Direction is
// where it fades in from (up: from the ground); Position moves the edge across the layer, from all shown at 0 to all
// hidden at 1, so a binding makes it a wipe; Both sides fades the far edge too, moving in with it; Invert flips it.
const params = {
  direction: { value: 'up', type: 'choice', options: DIRECTIONS, label: 'Direction',
    help: 'Which edge it fades in from; up is clear at the ground and full higher up.' },
  position: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Position',
    help: 'Moves the faded edge across the layer. 0 shows it all; higher pushes the edge in; 1 hides it all.' },
  width: { value: 0.35, min: 0.02, max: 1, step: 0.01, label: 'Width',
    help: 'How long the fade is. Low is a sharp cut-off; 1 grades it across the whole layer.' },
  both: { value: false, type: 'toggle', label: 'Both sides',
    help: 'On also fades the far edge, moving in with Position, leaving a band in the middle; off fades one edge.' },
  invert: { value: false, type: 'toggle', label: 'Invert',
    help: 'On flips it: what was clear shows and what showed fades away; off fades the edge as usual.' },
};

// Saved before both ways were named: round was clockwise.
function upgrade(s) {
  if (s.direction === 'round') s.direction = 'clockwise';
  return s;
}

function filter(c, q, t, P) {
  const at = toward(q, P.direction), edge = P.position * (1 + P.width) - P.width;   // -width: all shown; 1: none
  let k = smoothstep(0, P.width, at - edge);
  if (P.both) k *= smoothstep(0, P.width, 1 - at - edge);
  c[3] *= P.invert ? 1 - k : k;
  return c;
}
