// Life: a one-dimensional cellular automaton lives along every strand, a generation at a time at Speed, live cells
// walking Colours along it. Rule 30 is chaos, 90 triangles, 110 gliders; it starts again after Era generations.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  speed: { value: 4, min: 0.5, max: 20, step: 0.5, label: 'Speed (generations a second)' },
  rule: { value: 30, min: 0, max: 255, step: 1, label: 'Rule' },
  era: { value: 48, min: 8, max: 256, step: 1, label: 'Era (generations)' },
  density: { value: 0.4, min: 0.05, max: 0.95, step: 0.01, label: 'Alive at the start' },
};

const runs = [];          // per strand: its cells now and a generation before

function cells(s, n, era, gen, P) {
  let c = runs[s];
  if (!c || c.now.length !== n) c = runs[s] = { era: -1, gen: 0, now: new Uint8Array(n), was: new Uint8Array(n) };
  if (c.era !== era || c.gen > gen) {
    for (let i = 0; i < n; i++) c.now[i] = rand(s, i, era) < P.density ? 1 : 0;
    c.was.set(c.now);
    c.era = era; c.gen = 0;
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

// Each strand on its own beat, so no area blinks as one.
function pixel(p, t, P) {
  const x = clock('speed') + rand(p.fixture, 7), g = floor(x), len = round(P.era), era = floor(g / len);
  const c = cells(p.fixture, p.n, era, g - era * len, P);
  const alive = mix(c.was[p.i], c.now[p.i], smoothstep(0, 0.5, x - g));
  if (alive <= 0.002) return null;
  const col = pal('colours', p.u);
  col[3] = alive;
  return col;
}
