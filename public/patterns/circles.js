// Circles: balls drift and bounce round the layer at Speed, each a colour from Colours, melting together where they
// meet.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours' },
  speed: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Speed (crossings a second)' },
  count: { value: 5, min: 1, max: 8, step: 1, label: 'Count (balls)' },
  size: { value: 0.12, min: 0.03, max: 0.4, step: 0.01, label: 'Size (radius, share of the layer)' },
};

const BZ = new Float64Array(8), BY = new Float64Array(8);
let n = 0, r2 = 0;

function frame(t, P) {
  const s = clock('speed');
  n = round(P.count); r2 = P.size * P.size;
  for (let i = 0; i < n; i++) {
    BZ[i] = 0.08 + 0.84 * tri(s * (0.6 + 0.8 * rand(i, 1)) + rand(i, 2));
    BY[i] = 0.08 + 0.84 * tri(s * (0.5 + 0.8 * rand(i, 3)) + rand(i, 4));
  }
}

// Metaballs: each ball's field falls off with distance; where the sum passes 1 is inside, the nearest ball's colour.
function pixel(p) {
  let f = 0, best = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const dz = p.lz - BZ[i], dy = p.ly - BY[i];
    const w = r2 / (dz * dz + dy * dy + 1e-4);
    f += w;
    if (w > best) { best = w; b = i; }
  }
  const k = smoothstep(0.75, 1.1, f);
  if (k <= 0.002) return null;
  const c = swatch('colours', b);
  c[3] = k;
  return c;
}
