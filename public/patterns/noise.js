// Noise: fills the layer with noise coloured from Colours, low values the first colour, high the last, changing at
// Speed. Kind is its look: smooth blobs, layered (finer detail over them), ridged (bright creases), cells, or
// static (each LED on its own). Size is a blob's or cell's, as a share of the layer; Detail is how many finer layers
// layered and ridged add; Contrast pushes values toward the first and last colours. A plain field: a mask input.
const params = {
  kind: { value: 'smooth', type: 'choice', label: 'Kind',
    options: ['smooth', 'layered', 'ridged', 'cells', 'static'],
    help: 'Smooth blobs; layered adds finer detail; ridged, bright creases; cells, round cells; static, each LED.' },
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours the noise, from its lowest values to its highest.' },
  size: { value: 0.3, min: 0.05, max: 2, step: 0.01, label: 'Size (share of the layer)',
    help: 'How big each blob or cell is. Small gives a fine, busy grain; large gives broad, slow shapes.' },
  speed: { value: 0.2, min: 0, max: 2, step: 0.01, label: 'Speed (changes a second)',
    help: 'How fast the noise changes in place. 0 holds it still. Static changes ten times as fast.' },
  detail: { value: 4, min: 1, max: 6, step: 1, label: 'Detail',
    help: 'For layered and ridged: how many finer layers sit over the broad shapes. 1 is plain; 6 is rough.' },
  contrast: { value: 1, min: 0.25, max: 4, step: 0.01, label: 'Contrast',
    help: 'Low keeps to the middle colours; high pushes toward the first and last, into crisp shapes.' },
  seed: { value: 1, min: 0, max: 99, step: 1, label: 'Seed',
    help: 'Which noise you get. Each seed is different, always the same.' },
};

// Octaves of creased noise: each 1 on a crease, falling away from it.
function ridged(x, y, z, n) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < n; o++) {
    const r = 1 - abs(2 * noise(x, y, z) - 1);
    sum += amp * r * r; norm += amp; amp *= 0.5;
    x = x * 2 + 17.17; y = y * 2 - 9.31; z = z * 2 + 5.73;
  }
  return sum / norm;
}

// Cells: 1 at each cell's point, falling to 0 toward its edges; the points circle within their squares as z moves.
function cells(x, y, z) {
  const ix = floor(x), iy = floor(y);
  let d = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const h = rand(ix + i, iy + j), a = TAU * h + z * (1 + h);
      const dx = ix + i + 0.5 + 0.4 * cos(a) - x, dy = iy + j + 0.5 + 0.4 * sin(a) - y;
      d = min(d, dx * dx + dy * dy);
    }
  }
  return 1 - min(1, sqrt(d) * 1.2);
}

function pixel(p, t, P) {
  const c = clock('speed'), k = P.kind;
  let v;
  if (k === 'static') {                   // each LED blends from one dealt value to the next, out of step
    const s = c * 10 + p.seed * 7, i = floor(s);
    v = mix(rand(p.k, P.seed, i), rand(p.k, P.seed, i + 1), smoothstep(0, 1, s - i));
  } else {
    const s = 1 / P.size, o = P.seed * 7.31, x = p.lz * s + o, y = p.ly * s - o, z = p.lx * s * 0.5 + c;
    v = k === 'layered' ? fbm(x, y, z, P.detail) : k === 'ridged' ? ridged(x, y, z, P.detail)
      : k === 'cells' ? cells(x, y, z) : noise(x, y, z);
  }
  return pal('colours', clamp(0.5 + (v - 0.5) * P.contrast));
}
