// Life: a one-dimensional cellular automaton lives along every strand, a generation at a time at Speed. Rule: chaos
// (30), triangles (90), gliders (110) or traffic (184, cells queueing along); it starts again after Era generations.
// Colour by: Age (a cell is born at the start of Colours and walks to its end over 3 generations alive), Cell (each
// LED its own steady pick) or Along strand (one end of Colours at one end of the strand, the other at the other).
// Smoothing blends each cell into its neighbours and each generation into the next, so it flows instead of flickering.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'The palette the living cells take, read by age, by cell or along the strand as Colour by says.' },
  speed: { value: 4, min: 0.5, max: 20, step: 0.5, label: 'Speed (generations a second)',
    help: 'How fast generations pass. Low drifts slowly; high churns quickly.' },
  rule: { value: 'chaos', type: 'choice', options: ['chaos', 'triangles', 'gliders', 'traffic'], label: 'Rule',
    help: 'Chaos looks random, triangles nests patterns, gliders sends shapes moving, traffic queues cells along.' },
  by: { value: 'age', type: 'choice', options: ['age', 'cell', 'along'], label: 'Colour by (age, cell, along strand)',
    help: 'Age walks cells from first colour to last as they live; cell gives each LED one; along spans the strand.' },
  smoothing: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Smoothing',
    help: 'How much cells blend into neighbours and the next generation. Zero is crisp and flickery; high flows.' },
  era: { value: 48, min: 8, max: 256, step: 1, label: 'Era (generations)',
    help: 'How long before the strand reseeds and starts again. Low restarts often; high lets it evolve.' },
  density: { value: 0.4, min: 0.05, max: 0.95, step: 0.01, label: 'Alive at the start',
    help: 'The share of cells alive when an era begins. Low starts sparse; high starts crowded.' },
};

const runs = [];          // per strand: its cells now and a generation before
const RULES = { chaos: 30, triangles: 90, gliders: 110, traffic: 184 }, AGED = 3;

function cells(s, n, era, gen, P) {
  let c = runs[s];
  if (!c || c.now.length !== n) c = runs[s] = { era: -1, gen: 0, now: new Uint8Array(n), was: new Uint8Array(n),
    age: new Uint16Array(n), aged: new Uint16Array(n) };
  if (c.era !== era || c.gen > gen) {
    for (let i = 0; i < n; i++) c.now[i] = rand(s, i, era) < P.density ? 1 : 0;
    c.was.set(c.now); c.age.fill(0); c.aged.fill(0);
    c.era = era; c.gen = 0;
  }
  const rule = RULES[P.rule] ?? 30;
  for (; c.gen < gen; c.gen++) {
    c.was.set(c.now); c.aged.set(c.age);
    const w = c.was;
    for (let i = 0; i < n; i++) {
      const l = w[i ? i - 1 : n - 1], r = w[i < n - 1 ? i + 1 : 0];
      c.now[i] = (rule >> ((l << 2) | (w[i] << 1) | r)) & 1;
      c.age[i] = c.now[i] && w[i] ? min(c.age[i] + 1, AGED) : 0;      // generations alive, from 0 at birth
    }
  }
  return c;
}

// Cell i blended into its neighbours l and r by k.
const at = (a, i, l, r, k) => a[i] * (1 - k * 2 / 3) + (a[l] + a[r]) * k / 3;

// Each strand on its own beat, so no area blinks as one.
function pixel(p, t, P) {
  const x = clock('speed') + rand(p.fixture, 7), g = floor(x), len = round(P.era), era = floor(g / len);
  const c = cells(p.fixture, p.n, era, g - era * len, P);
  const k = P.smoothing, i = p.i, l = i ? i - 1 : p.n - 1, r = i < p.n - 1 ? i + 1 : 0;
  const f = smoothstep(0, 0.1 + 0.9 * k, x - g), alive = mix(at(c.was, i, l, r, k), at(c.now, i, l, r, k), f);
  if (alive <= 0.002) return null;
  const age = c.now[i] ? (c.was[i] ? mix(c.aged[i], c.age[i], f) : 0) : c.aged[i];   // a dying cell keeps its age
  const col = pal('colours', P.by === 'cell' ? p.seed : P.by === 'along' ? p.u : age / AGED);
  col[3] = alive;
  return col;
}
