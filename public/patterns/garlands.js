// Garlands: rows of swags (parabolas between hooks) drape down the layer one by one, then fade, in body and
// accent colours over the low colour; energy lights the hooks. rows, swags, sag, thick, every (seconds a row).
const params = {
  rows: { value: 5, min: 1, max: 12, step: 1 },
  swags: { value: 4, min: 1, max: 12, step: 1, label: 'Swags per row' },
  sag: { value: 0.08, min: 0, max: 0.3, step: 0.005, label: 'Sag (share of the height)' },
  thick: { value: 0.035, min: 0.01, max: 0.15, step: 0.005, label: 'Thickness' },
  every: { value: 0.8, min: 0.2, max: 4, step: 0.05, label: 'Seconds per row' },
};

// The i-th band: body and accent colours in turn, spread along each role.
const swatch = (i) => pal(i & 1 ? 'accent' : 'body', fract(i * 0.618));

function pixel(p, t, P, G) {
  const n = round(P.rows), ph = (t / P.every) % (n + 2);              // rows hung so far
  const hook = fract(p.lz * P.swags) * 2 - 1;                          // −1 … 1 between two hooks
  const y = p.ly + P.sag * (1 - hook * hook);                          // swags straightened out
  const fade = 1 - smoothstep(n + 1, n + 2, ph);
  const j0 = round((1 - y) * n - 0.5);
  let v = 0, row = 0;
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    if (j < 0 || j >= n || ph < j) continue;
    const drop = smoothstep(0, 1, ph - j), at = 1 - (j + 0.5) / n + (1 - drop) * 0.25;
    const k = smoothstep(P.thick, P.thick * 0.4, abs(y - at)) * drop;
    if (k > v) { v = k; row = j; }
  }
  const c = mix(pal('low', p.ly), swatch(row), v * fade);
  return mix(c, pal('high'), v * fade * pulse(p.lz * P.swags, 0.08) * G.energy);
}
