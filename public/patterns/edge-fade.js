// Edge fade: fades what is above it out toward one edge of the layer, so it melts into what is below. Direction is
// where it fades in from (up: from the ground); Position moves the edge across the layer, so a binding makes it a
// wipe; Both sides fades the far edge too; Invert fades the middle instead.
const params = {
  direction: { value: 'up', type: 'choice', options: DIRECTIONS, label: 'Direction',
    help: 'Which edge it fades in from; up is clear at the ground and full higher up.' },
  position: { value: 0, min: 0, max: 1, step: 0.01, label: 'Position',
    help: 'Moves the faded edge across the layer. 0 starts it at the edge; higher pushes it in, hiding more.' },
  width: { value: 0.35, min: 0.02, max: 1, step: 0.01, label: 'Width',
    help: 'How long the fade is. Low is a sharp cut-off; 1 grades it across the whole layer.' },
  both: { value: false, type: 'toggle', label: 'Both sides',
    help: 'On also fades the far edge, leaving a band in the middle; off fades one edge only.' },
  invert: { value: false, type: 'toggle', label: 'Invert',
    help: 'On flips it: what was clear shows and what showed fades away; off fades the edge as usual.' },
};

function filter(c, q, t, P) {
  const x = toward(q, P.direction) - P.position;
  let k = smoothstep(0, P.width, x);
  if (P.both) k *= smoothstep(0, P.width, 1 - P.position - x);
  c[3] *= P.invert ? 1 - k : k;
  return c;
}
