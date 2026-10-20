// Circles: balls drift and bounce round the layer at Speed, each a colour from Colours, melting together in shape and
// colour where they meet.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'Which palette colours the balls, one colour a ball, blending where they meet.' },
  speed: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Speed (crossings a second)',
    help: 'How fast the balls drift and bounce. 0 holds them still; high darts them about.' },
  count: { value: 5, min: 1, max: 8, step: 1, label: 'Count (balls)',
    help: 'How many balls there are. One drifts alone; more crowd together and merge into blobs.' },
  size: { value: 0.12, min: 0.03, max: 0.4, step: 0.01, label: 'Size (radius, share of the layer)',
    help: 'How big each ball is. Small gives dots; large gives big blobs that merge often.' },
};

const BZ = new Float64Array(8), BY = new Float64Array(8), RGB = new Float64Array(24);
let n = 0, r2 = 0;

function frame(t, P) {
  const s = clock('speed') * 0.5;                    // tri goes there and back: two crossings a cycle
  n = round(P.count); r2 = P.size * P.size;
  for (let i = 0; i < n; i++) {
    BZ[i] = 0.08 + 0.84 * tri(s * (0.6 + 0.8 * rand(i, 1)) + rand(i, 2));
    BY[i] = 0.08 + 0.84 * tri(s * (0.5 + 0.8 * rand(i, 3)) + rand(i, 4));
    const c = swatch('colours', i);
    RGB[i * 3] = c[0]; RGB[i * 3 + 1] = c[1]; RGB[i * 3 + 2] = c[2];
  }
}

// Metaballs: each field falls off with distance; inside is where the sum passes 1, coloured by each ball's share.
function pixel(p) {
  let f = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const dz = p.lz - BZ[i], dy = p.ly - BY[i];
    const w = r2 / (dz * dz + dy * dy + 1e-4);
    f += w; r += w * RGB[i * 3]; g += w * RGB[i * 3 + 1]; b += w * RGB[i * 3 + 2];
  }
  const k = smoothstep(0.75, 1.1, f);
  if (k <= 0.002) return null;
  const c = rgb(r / f, g / f, b / f);
  c[3] = k;
  return c;
}
