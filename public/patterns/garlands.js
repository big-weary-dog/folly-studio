// Garlands: rows of swags drape across the layer one after another in Direction at Speed, then fade and start again,
// each row a colour from Colours, moving on a colour each time round. Sag is how deep each swag hangs.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'Which palette colours the rows, one colour a row.' },
  direction: { value: 'down', type: 'choice', options: ['up', 'down'], label: 'Direction',
    help: 'Which way the rows are hung one after another: down from the top, up from the bottom.' },
  speed: { value: 1.25, min: 0.25, max: 5, step: 0.05, label: 'Speed (rows a second)',
    help: 'How fast rows hang one after another. Low drapes slowly; high fills the layer in a rush.' },
  rows: { value: 4, min: 1, max: 12, step: 1, label: 'Rows',
    help: 'How many rows of swags fill the layer before they fade and start again.' },
  swags: { value: 4, min: 1, max: 12, step: 1, label: 'Swags a row',
    help: 'How many swags hang across each row. Few gives long, wide loops; many gives small, tight ones.' },
  sag: { value: 0.08, min: 0, max: 0.3, step: 0.005, label: 'Sag',
    help: 'How deep each swag hangs between its hooks. 0 is a straight line; high a deep droop.' },
  width: { value: 0.06, min: 0.01, max: 0.15, step: 0.005, label: 'Width',
    help: 'How thick each garland is. Low is a fine line; high a broad band.' },
};

function pixel(p, t, P) {
  const d = P.direction, n = round(P.rows), go = clock('speed') / (n + 2), ph = fract(go) * (n + 2);  // rows so far
  const hook = fract(p.lz * P.swags) * 2 - 1;                                     // −1 … 1 between two hooks
  const y = 1 - toward(p, d) + (d === 'up' ? -P.sag : P.sag) * (1 - hook * hook);  // swags straightened out
  const j0 = round((1 - y) * n - 0.5);
  let v = 0, row = 0;
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    if (j < 0 || j >= n || ph < j) continue;
    const drop = smoothstep(0, 1, ph - j), at = 1 - (j + 0.5) / n + (1 - drop) * 0.25;
    const k = smoothstep(P.width, P.width * 0.4, abs(y - at)) * drop;
    if (k > v) { v = k; row = j; }
  }
  v *= 1 - smoothstep(n + 1, n + 2, ph);
  if (v <= 0.002) return null;
  const c = swatch('colours', row + floor(go) * n);
  c[3] = v;
  return c;
}
