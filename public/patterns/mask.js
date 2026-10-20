// Mask: shows what is above it only where its input, another source (usually input only), is brighter than Cutoff;
// By self, where what is above it is, by luminance (so busy textures become crisp shapes). Invert shows it where the
// input is dark. Amount is how fully it hides the rest: hidden is transparent. By input with no input it does nothing.
const params = {
  by: { value: 'input', type: 'choice', options: ['input', 'self'], label: 'Brightness of',
    help: 'Input masks by another source fed in; self masks by what is above, turning textures into shapes.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mask strength',
    help: 'How fully the masked part is hidden. Zero hides nothing; one makes it fully transparent.' },
  cutoff: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Brightness where it opens',
    help: 'The brightness the mask opens at. Low lets most through; high shows only the brightest parts.' },
  softness: { value: 0.3, min: 0.01, max: 1, step: 0.01, label: 'Edge softness (share of brightness)',
    help: 'How gradual the mask edge is. Low cuts hard; high fades over a wide range of brightness.' },
  invert: { value: false, type: 'toggle', label: 'Show where the input is dark',
    help: 'Off shows it where the mask source is bright; on shows it where the source is dark.' },
};

function filter(c, q, t, P, G, x) {
  const s = P.by === 'self' ? c : x;
  if (!s) return c;
  const b = (P.by === 'self' ? 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2] : max(s[0], s[1], s[2])) * s[3];
  let m = smoothstep(P.cutoff - P.softness / 2, P.cutoff + P.softness / 2, b);
  if (P.invert) m = 1 - m;
  c[3] *= 1 - P.amount * (1 - m);        // c is the chain's colour: change it and hand it back
  return c;
}
