// Edge fade: fades what is above it out toward one edge of the layer, so it melts into what is below. Direction is
// where it fades in from (up: from the ground); Position moves the edge across the layer, so a binding makes it a
// wipe; Both sides fades the far edge too; Invert fades the middle instead.
const params = {
  direction: { value: 'up', type: 'choice', options: DIRECTIONS, label: 'Direction' },
  position: { value: 0, min: 0, max: 1, step: 0.01, label: 'Position' },
  width: { value: 0.35, min: 0.02, max: 1, step: 0.01, label: 'Width' },
  oneSide: { value: true, type: 'toggle', label: 'From one side only' },
  invert: { value: false, type: 'toggle', label: 'Invert' },
};

function filter(c, q, t, P) {
  const x = toward(q, P.direction) - P.position;
  let k = smoothstep(0, P.width, x);
  if (!P.oneSide) k *= smoothstep(0, P.width, 1 - P.position - x);
  c[3] *= P.invert ? 1 - k : k;
  return c;
}
