// Arch chase: arches light in turn by strand number (mod count: 5 goes bay by bay, front to back), each
// filling along its wire behind a highlight head (plus energy), then fading over `trail` steps. rate.
const params = {
  rate: { value: 1, min: 0.25, max: 6, step: 0.05, label: 'Arches a second' },
  count: { value: 5, min: 2, max: 40, step: 1, label: 'Arches in the cycle' },
  trail: { value: 1.5, min: 0.2, max: 6, step: 0.1, label: 'Fade (steps)' },
};

function pixel(p, t, P, G) {
  const n = round(P.count), x = t * P.rate, step = floor(x), f = x - step;
  const age = (((step - p.strand) % n) + n) % n + f;           // steps since this arch's turn began
  const head = f * 1.3;
  const lit = age < 1 ? smoothstep(head, head - 0.05, p.u) : exp(-(age - 1) / P.trail);
  const c = mix(pal('low', p.u), pal('body', p.u), lit);
  return age < 1 ? mix(c, pal('high'), exp(-((p.u - head) ** 2) * 600) * (0.5 + 0.5 * G.energy)) : c;
}
