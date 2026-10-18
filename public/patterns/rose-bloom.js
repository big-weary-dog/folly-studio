// Rose bloom: the rose window opens ring by ring (p.ring 1–7; elsewhere r) from its heart, holds, closes to a
// bud. cycle (seconds), petals (every other leans to accent), flare (highlight as a ring opens, plus energy).
const params = {
  cycle: { value: 6, min: 2, max: 30, step: 0.5, label: 'Seconds per bloom' },
  petals: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Petal contrast' },
  flare: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Highlight as a ring opens' },
};

function pixel(p, t, P, G) {
  const rr = p.ring > 0 ? (p.ring - 0.5) / 7 : p.r, petal = p.sector >= 0 ? p.sector : floor(p.a * 16);
  const ph = fract(t / P.cycle);
  const front = (smoothstep(0, 0.55, ph) - smoothstep(0.75, 1, ph)) * 1.1;
  const open = smoothstep(front, front - 0.08, rr);
  const bloom = mix(pal('body', rr), pal('accent', rr), (petal % 2) * P.petals);
  const c = mix(pal('low', rr), bloom, open);
  const fl = ph < 0.6 ? exp(-(((rr - front) / 0.07) ** 2)) * P.flare * (0.5 + 0.5 * G.energy) : 0;
  return mix(c, pal('high'), fl);
}
