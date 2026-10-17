// Mask: shows the chain only where its input is bright, e.g. meteors only inside the clouds.
//
// Pick another source in this chain as the filter's input (usually one marked "input only", so it
// is not drawn itself). The input's brightness, its brightest channel times its alpha, opens the
// mask: past `cutoff` the chain shows, below it the chain's alpha falls toward 1 − amount. `invert`
// masks where the input is dark instead. With no input the chain passes through unchanged.
const params = {
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mask strength' },
  cutoff: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Brightness where it opens' },
  softness: { value: 0.3, min: 0.01, max: 1, step: 0.01, label: 'Edge softness' },
  invert: { value: false, type: 'toggle', label: 'Show where the input is dark' },
};

function filter(c, q, t, P, G, x) {
  if (!x) return c;
  const b = max(x[0], x[1], x[2]) * x[3];
  let m = smoothstep(P.cutoff - P.softness / 2, P.cutoff + P.softness / 2, b);
  if (P.invert) m = 1 - m;
  c[3] *= 1 - P.amount * (1 - m);        // c is the chain's colour: change it and hand it back
  return c;
}
