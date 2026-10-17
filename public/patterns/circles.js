// Circles: body and accent balls bounce round the layer and melt together where they meet (metaballs), rims
// in the highlight over the low colour. count, size (energy swells them), speed (crossings a second).
const params = {
  count: { value: 5, min: 1, max: 8, step: 1, label: 'Balls' },
  size: { value: 0.12, min: 0.03, max: 0.4, step: 0.01, label: 'Ball radius' },
  speed: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Crossings a second' },
};

const BZ = new Float64Array(8), BY = new Float64Array(8);
let n = 0, r2 = 0;

function frame(t, P, G) {
  n = round(P.count);
  r2 = (P.size * (0.7 + 0.6 * G.energy)) ** 2;
  for (let i = 0; i < n; i++) {
    BZ[i] = 0.08 + 0.84 * tri(t * P.speed * (0.6 + 0.8 * rand(i, 1)) + rand(i, 2));
    BY[i] = 0.08 + 0.84 * tri(t * P.speed * (0.5 + 0.8 * rand(i, 3)) + rand(i, 4));
  }
}

function pixel(p) {
  let f = 0, best = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const dz = p.lz - BZ[i], dy = p.ly - BY[i];
    const w = r2 / (dz * dz + dy * dy + 1e-4);
    f += w;
    if (w > best) { best = w; b = i; }
  }
  const inside = b % 2 ? pal('accent', rand(b, 5)) : pal('body', rand(b, 6));
  const c = mix(pal('low', p.ly), inside, smoothstep(0.75, 1.1, f));
  return mix(c, pal('high'), exp(-(f - 0.9) * (f - 0.9) * 40) * 0.8);
}
