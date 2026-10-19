// Fireworks: shells burst high on the layer into rings of sparks that sag and fade, each its own colour from Colours.
// Speed is bursts a second from each of Shells; Size is how far they spread.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours' },
  speed: { value: 0.45, min: 0.1, max: 1.5, step: 0.01, label: 'Speed (bursts a second, each shell)' },
  shells: { value: 4, min: 1, max: 6, step: 1, label: 'Shells' },
  size: { value: 0.34, min: 0.1, max: 0.6, step: 0.01, label: 'Size (radius, share of the layer)' },
  sparks: { value: 12, min: 4, max: 32, step: 1, label: 'Sparks round a burst' },
};

const CZ = new Float64Array(6), CY = new Float64Array(6), AGE = new Float64Array(6), ID = new Float64Array(6);
let on = 0;

function frame(t, P) {
  on = round(P.shells);
  for (let s = 0; s < on; s++) {
    const x = clock('speed') + rand(s, 9), c = floor(x), a = x - c;     // a: how far through its burst
    ID[s] = c * 6 + s; AGE[s] = a;
    CZ[s] = 0.15 + 0.7 * rand(s, c, 1);
    CY[s] = 0.5 + 0.35 * rand(s, c, 2) - 0.24 * a * a;                  // the burst sags as it falls
  }
}

function pixel(p, t, P) {
  let best = 0, id = 0;
  for (let s = 0; s < on; s++) {
    const a = AGE[s], R = P.size * (1 - exp(-a * 6.6)), dz = p.lz - CZ[s], dy = p.ly - CY[s], d = hypot(dz, dy);
    if (d > R + 0.03) continue;
    const spark = pulse(atan2(dz, dy) / TAU * P.sparks + rand(ID[s], 3), 0.45);
    const v = (spark * smoothstep(R * 0.2, R, d) + 0.25) * exp(-a * 2) + exp(-d * d * 300 - a * 13);
    if (v > best) { best = v; id = ID[s]; }
  }
  if (best < 0.004) return null;
  const c = swatch('colours', id);
  c[3] = min(1, best * 1.5);
  return c;
}
