// Mask: shows what is above it only where its input, another source (usually input only), is brighter than Cutoff;
// By self, where what is above it is (so busy textures become crisp shapes). Invert shows it where the input is dark.
// Amount is how fully it hides the rest: hidden is transparent. By input with no input it does nothing.
const params = {
  by: { value: 'input', type: 'choice', options: ['input', 'self'], label: 'Brightness of' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mask strength' },
  cutoff: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Brightness where it opens' },
  softness: { value: 0.3, min: 0.01, max: 1, step: 0.01, label: 'Edge softness' },
  invert: { value: false, type: 'toggle', label: 'Show where the input is dark' },
};

function filter(c, q, t, P, G, x) {
  const s = P.by === 'self' ? c : x;
  if (!s) return c;
  const b = max(s[0], s[1], s[2]) * s[3];
  let m = smoothstep(P.cutoff - P.softness / 2, P.cutoff + P.softness / 2, b);
  if (P.invert) m = 1 - m;
  c[3] *= 1 - P.amount * (1 - m);        // c is the chain's colour: change it and hand it back
  return c;
}
