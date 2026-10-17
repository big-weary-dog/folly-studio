// Wash breathe: the layer breathes from the low colour up through the body and back, each inhale rising from
// the ground, never dark; full breaths touch the highlight (more with energy). breath (seconds), rise, depth.
const params = {
  breath: { value: 6, min: 2, max: 20, step: 0.5, label: 'Seconds per breath' },
  rise: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Inhale rises from the ground' },
  depth: { value: 0.8, min: 0, max: 1, step: 0.01, label: 'How full each breath gets' },
};

function pixel(p, t, P, G) {
  const v = (0.5 - 0.5 * cos(TAU * (t / P.breath - p.ly * P.rise))) * P.depth;
  const body = pal('body', 0.6 * p.lz + 0.4 * p.lx);
  if (v < 0.5) return mix(pal('low', p.ly), body, v * 2);
  return mix(body, pal('high'), (v - 0.5) * 2 * (0.3 + 0.7 * G.energy));
}
