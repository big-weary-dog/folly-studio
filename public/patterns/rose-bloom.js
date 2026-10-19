// Rose bloom: the rose window opens ring by ring from its heart, by Open (0 a bud, 1 in flower; elsewhere by the
// radius); bind Open to a hold LFO or the clip envelope to draw it. Rings walk Colours outward; every other petal
// walks them the other way (by Petals); the opening edge flares in the last colour.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  open: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Open' },
  petals: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Petals' },
  flare: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Flare' },
};

function pixel(p, t, P) {
  const rr = p.ring > 0 ? (p.ring - 0.5) / 7 : p.r, petal = p.sector >= 0 ? p.sector : floor(p.a * 16);
  const front = P.open * 1.1, shown = smoothstep(front, front - 0.08, rr);
  if (shown <= 0.002) return null;
  const c = mix(pal('colours', mix(rr, 1 - rr, (petal % 2) * P.petals)), pal('colours', 1),
    exp(-(((rr - front) / 0.07) ** 2)) * P.flare);
  c[3] = shown;
  return c;
}
