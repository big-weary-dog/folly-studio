// Shockwave: a ring bursts from the layer's middle in 3D (lx ly lz), a sphere through arches and spires: highlight
// front (harder with energy), accent wake, low colour ahead. every (seconds), width (grows), height (centre).
const params = {
  every: { value: 2, min: 0.5, max: 8, step: 0.1, label: 'Seconds between waves' },
  width: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: 'Ring width' },
  height: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Centre height' },
};

function pixel(p, t, P, G) {
  const a = fract(t / P.every), R = 1.2 * (1 - (1 - a) ** 3);              // bursts fast, then slows
  const d = hypot(p.lx - 0.5, p.ly - P.height, p.lz - 0.5);
  const x = (R - d) / (P.width * (0.5 + a));                 // > 0 behind the front
  const fade = 1 - a * a * a;
  const c = mix(pal('low', d), pal('accent', d), (x > 0 ? exp(-x * 0.3) : exp(-x * x * 9)) * fade);
  return mix(c, pal('high'), exp(-x * x * 4) * fade * (0.5 + 0.5 * G.energy));
}
