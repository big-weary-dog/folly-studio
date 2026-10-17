// Edge fade: fades the chain's alpha toward the layer's edges, so it melts into what is below. axis (across,
// up, front to back, out from the centre), width, oneSide (on `up`: from the ground), invert.
const params = {
  axis: { value: 1, min: 0, max: 3, step: 1, label: 'Across, up, front → back, out from the centre' },
  width: { value: 0.35, min: 0.02, max: 1, step: 0.01, label: 'Fade reach' },
  oneSide: { value: true, type: 'toggle', label: 'From one side only' },
  invert: { value: false, type: 'toggle', label: 'Fade the middle instead' },
};

function filter(c, q, t, P) {
  const a = round(P.axis), x = a === 0 ? q.lz : a === 1 ? q.ly : a === 2 ? q.lx : 1 - q.r;
  let k = smoothstep(0, P.width, x);
  if (!P.oneSide && a < 3) k *= smoothstep(0, P.width, 1 - x);
  c[3] *= P.invert ? 1 - k : k;
  return c;
}
