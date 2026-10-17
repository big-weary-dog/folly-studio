// Life: a 1D cellular automaton along every strand by Wolfram's rule (30 chaos, 90 Sierpinski, 110 gliders),
// each strand on its own beat so no area blinks as one; reseeded every `era`. rate, density. Body colours live,
// newborns glow toward the highlight (more with energy), the dead rest at the low colour.
const params = {
  rule: { value: 30, min: 0, max: 255, step: 1 },
  rate: { value: 4, min: 0.5, max: 20, step: 0.5, label: 'Generations a second' },
  era: { value: 48, min: 8, max: 256, step: 1, label: 'Generations before reseeding' },
  density: { value: 0.4, min: 0.05, max: 0.95, step: 0.01, label: 'Alive at a reseed' },
};

const runs = [];          // per strand: its cells now and a generation before

function cells(s, n, era, gen, P) {
  let c = runs[s];
  if (!c || c.now.length !== n) {
    c = runs[s] = { era: -1, gen: 0, now: new Uint8Array(n), was: new Uint8Array(n) };
  }
  if (c.era !== era || c.gen > gen) {
    for (let i = 0; i < n; i++) c.now[i] = rand(s, i, era) < P.density ? 1 : 0;
    c.was.set(c.now);
    c.era = era;
    c.gen = 0;
  }
  const rule = round(P.rule);
  for (; c.gen < gen; c.gen++) {
    c.was.set(c.now);
    const w = c.was;
    for (let i = 0; i < n; i++) {
      const l = w[i ? i - 1 : n - 1], r = w[i < n - 1 ? i + 1 : 0];
      c.now[i] = (rule >> ((l << 2) | (w[i] << 1) | r)) & 1;
    }
  }
  return c;
}

function pixel(p, t, P, G) {
  const x = t * P.rate + rand(p.strand, 7), g = floor(x), len = round(P.era), era = floor(g / len);
  const c = cells(p.strand, p.n, era, g - era * len, P);
  const now = c.now[p.i], was = c.was[p.i], k = smoothstep(0, 0.5, x - g);
  const alive = mix(was, now, k);
  const col = mix(pal('low', p.u), pal('body', p.u), alive);
  return now && !was ? mix(col, pal('high'), (1 - k) * k * (0.6 + 0.8 * G.energy)) : col;
}
