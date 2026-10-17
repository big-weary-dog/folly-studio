// Spire rise: body colour climbs every spire (ly) under a highlight head (plus energy), crowns the tip, lifts
// away; towers (zones) start `stagger` of a rise apart. every (seconds a rise), head (its length).
const params = {
  every: { value: 4, min: 1, max: 20, step: 0.1, label: 'Seconds per rise' },
  stagger: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Towers apart (share of a rise)' },
  head: { value: 0.06, min: 0.02, max: 0.3, step: 0.01, label: 'Head length' },
};

function pixel(p, t, P, G) {
  const ph = fract(t / P.every - rand(p.zi, 3) * P.stagger);
  const top = smoothstep(0, 0.6, ph) * 1.1, foot = smoothstep(0.72, 1, ph) * 1.1;   // the lit column's ends
  const lit = smoothstep(top, top - 0.03, p.ly) * smoothstep(foot - 0.03, foot, p.ly);
  const c = mix(pal('low', p.ly), pal('body', p.ly), lit);
  const head = exp(-(((p.ly - top) / P.head) ** 2)) * (1 - foot);
  const crown = pulse(ph - 0.66, 0.1) * smoothstep(0.7, 1, p.ly);
  return mix(c, pal('high'), max(head * (0.5 + 0.5 * G.energy), crown));
}
