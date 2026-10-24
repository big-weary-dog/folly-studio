// Recolour: recolours what is above it along Colours by its luminance: dark parts take the first colours, bright parts
// the last. Shade keeps its light and shade (each colour as bright as what it replaces). Steps snaps both to that many
// flat bands. Contrast stretches the walk; Shift slides along the colours, and Drift slides at that many a second
// (back and forth at the ends). Amount blends it with the colour it had.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'The palette that replaces the colours: dark parts take its first colours, bright parts its last.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount',
    help: 'How fully the new colours replace the old. Zero leaves them as they were; one is fully recoloured.' },
  shade: { value: true, type: 'toggle', label: 'Keep light and shade',
    help: 'On keeps each part as bright as it was; off gives every part the full brightness of its new colour.' },
  steps: { value: 1, min: 1, max: 12, step: 1, label: 'Steps (1: smooth)',
    help: 'Snaps the colours to this many flat bands, dark to bright. 1 keeps it smooth; 2 is hard light and dark.' },
  contrast: { value: 1, min: 0.2, max: 4, step: 0.05, label: 'Contrast',
    help: 'How far brightness stretches over the colours. Low uses only the middle; high bounces through them all.' },
  shift: { value: 0, min: -1, max: 1, step: 0.01, label: 'Shift (along the colours)',
    help: 'Slides which colour each brightness takes. Zero is as is; either way moves along the palette.' },
  drift: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Drift (palette spans a second)',
    help: 'Keeps sliding along the colours over time. Zero holds still; negative slides the other way.' },
};

function upgrade(s) {
  if (s.steps === 0) s.steps = 1;
  return s;
}

const snap = (v, n) => (n < 2 ? v : min(n - 1, floor(clamp(v) * n)) / (n - 1));    // n flat bands (under 2: smooth)

function filter(c, q, t, P) {
  const n = round(P.steps), v = snap(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], n);  // luminance: which colour
  const m = pal('colours', tri(((v - 0.5) * P.contrast + 0.5 + P.shift + clock('drift')) / 2));
  const k = P.shade ? max(n < 2 ? 0 : 1 / (n - 1), snap(max(c[0], c[1], c[2]), n)) : 1;
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], m[i] * k, P.amount);
  return c;
}
