// Mask: shows what is above it only where its input, another source (usually input only), is brighter than Cutoff;
// Invert shows it where the input is dark. Amount is how fully it hides the rest. With no input it does nothing.
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
