// Posterize: snaps what is above it to Steps flat bands of Colours by its luminance (dark parts the first colours,
// bright parts the last), each band as bright as its own step, so the layer keeps your palette. Amount blends it with
// the colour it had.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'The palette the bands take: the darkest band its first colour, the brightest its last.' },
  steps: { value: 4, min: 2, max: 12, step: 1, label: 'Steps',
    help: 'How many flat bands. Two is hard light and dark; more keeps smoother gradients.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount',
    help: 'How far the colours snap to the bands. Zero leaves them as they were; one is full banding.' },
};

function filter(c, q, t, P) {
  const n = max(2, round(P.steps)), snap = (v) => min(n - 1, floor(clamp(v) * n)) / (n - 1);
  const m = pal('colours', snap(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]));    // luminance: which band
  const k = max(1 / (n - 1), snap(max(c[0], c[1], c[2])));                           // its brightness, stepped
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], m[i] * k, P.amount);
  return c;
}
