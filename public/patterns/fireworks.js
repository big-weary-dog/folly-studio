// Fireworks: shells burst high into rings of sparks that sag and fade, body or accent with a white-hot heart,
// over a night of the low colour at `sky`. every (seconds per slot; energy fills more slots), size, sparks.
const params = {
  every: { value: 2.2, min: 0.8, max: 8, step: 0.1, label: 'Seconds between bursts (each slot)' },
  size: { value: 0.34, min: 0.1, max: 0.6, step: 0.01, label: 'Burst radius' },
  sparks: { value: 12, min: 4, max: 32, step: 1, label: 'Sparks round a burst' },
  sky: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Sky brightness' },
};

const SLOTS = 6;
const CZ = new Float64Array(SLOTS), CY = new Float64Array(SLOTS), AGE = new Float64Array(SLOTS);
const ID = new Float64Array(SLOTS);
let on = 0;

function frame(t, P, G) {
  on = 2 + round(G.energy * 4);
  for (let s = 0; s < on; s++) {
    const x = t / P.every + rand(s, 9), c = floor(x), a = (x - c) * P.every;
    ID[s] = c * SLOTS + s;
    AGE[s] = a;
    CZ[s] = 0.15 + 0.7 * rand(s, c, 1);
    CY[s] = 0.5 + 0.35 * rand(s, c, 2) - 0.05 * a * a;          // the burst sags as it falls
  }
}

function pixel(p, t, P) {
  let c = scale(pal('low', p.ly), P.sky);
  for (let s = 0; s < on; s++) {
    const a = AGE[s], R = P.size * (1 - exp(-a * 3));
    const dz = p.lz - CZ[s], dy = p.ly - CY[s], d = hypot(dz, dy);
    if (d > R + 0.03) continue;
    const spark = pulse(atan2(dz, dy) / TAU * P.sparks + rand(ID[s], 3), 0.45);
    const v = (spark * smoothstep(R * 0.2, R, d) + 0.25) * exp(-a * 0.9) + exp(-d * d * 300 - a * 6);
    const hue = ID[s] % 2 ? pal('accent', rand(ID[s], 4)) : pal('body', rand(ID[s], 5));
    c = mix(c, mix(hue, pal('high'), exp(-a * 5)), min(1, v * 1.5));
  }
  return c;
}
