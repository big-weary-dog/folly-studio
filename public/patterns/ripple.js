// Ripple: drops land at seeded spots and spread accent rings with highlight crests, like rain on a pond
// (xLights). every (seconds per slot; energy fills more slots), speed (layer widths a second), width.
const params = {
  every: { value: 2.5, min: 0.5, max: 10, step: 0.1, label: 'Seconds between drops (each slot)' },
  speed: { value: 0.25, min: 0.05, max: 1, step: 0.01, label: 'Ring speed' },
  width: { value: 0.05, min: 0.005, max: 0.15, step: 0.005, label: 'Ring width' },
};

const SLOTS = 8;
const CZ = new Float64Array(SLOTS), CY = new Float64Array(SLOTS), AGE = new Float64Array(SLOTS);
let on = 0;

function frame(t, P, G) {
  on = 2 + round(G.energy * 6);
  for (let s = 0; s < on; s++) {
    const x = t / P.every + rand(s, 7), c = floor(x);
    AGE[s] = (x - c) * P.every;
    CZ[s] = 0.1 + 0.8 * rand(s, c, 1);
    CY[s] = 0.1 + 0.8 * rand(s, c, 2);
  }
}

function pixel(p, t, P) {
  let v = 0;
  for (let s = 0; s < on; s++) {
    const R = AGE[s] * P.speed, d = hypot(p.lz - CZ[s], p.ly - CY[s]);
    if (d > R + 3 * P.width) continue;
    const x = (d - R) / P.width, y = x + 4;
    v += (exp(-x * x) + 0.5 * exp(-y * y)) * exp(-AGE[s] * 0.8);
  }
  const c = mix(pal('low', 0.5 + 0.5 * sin(p.lz * 9 + p.ly * 5 + t * 0.3)), pal('accent', p.ly), min(1, v));
  return mix(c, pal('high'), smoothstep(0.7, 1.2, v));
}
