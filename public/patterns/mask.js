// Mask: shows what is above it only where its input, another source (usually input only), is brighter than Cutoff;
// By self, where what is above it is, by luminance (so busy textures become crisp shapes); by region, on the rose's
// panes Pick chooses of a Rule's regions (odd petals, a spiral arm), with no input. Invert shows the rest. Amount is
// how fully it hides the rest: hidden is transparent. By input with no input it does nothing.
const params = {
  by: { value: 'input', type: 'choice', options: ['input', 'self', 'region'], label: 'Mask by',
    help: 'Input masks by another source fed in; self by what is above (textures to shapes); region by rose panes.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mask strength',
    help: 'How fully the masked part is hidden. Zero hides nothing; one makes it fully transparent.' },
  cutoff: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Brightness where it opens',
    help: 'The brightness the mask opens at. Low lets most through; high shows only the brightest parts.' },
  softness: { value: 0.3, min: 0.01, max: 1, step: 0.01, label: 'Edge softness',
    help: 'How gradual the edge is, a share of brightness (or by region, of a pane). Low cuts hard; high fades wide.' },
  invert: { value: false, type: 'toggle', label: 'Show where the input is dark',
    help: 'Off shows it where the mask source is bright (or the picked panes); on shows the rest.' },
  rule: { value: 'alternate', type: 'choice', label: 'Region rule',
    options: ['petal', 'alternate', 'ring', 'rings', 'centre', 'spiral', 'wedges', 'checker', 'random'],
    help: 'By region: which panes make one region: a petal, alternate petals, a ring, a spiral arm, a wedge, ….' },
  size: { value: 2, min: 1, max: 8, step: 1, label: 'Petals a region',
    help: 'By region, for spiral, wedges and checker: how many petals one region spans. 4 gives four big wedges.' },
  pick: { value: 'odd', type: 'choice', options: ['all', 'even', 'odd', 'one', 'every'], label: 'Show regions',
    help: 'By region: all, the even or odd ones, just one (Index), or every Index-th from the first.' },
  index: { value: 0, min: 0, max: 15, step: 1, label: 'Index',
    help: 'By region: which one region shows (one), or the step between those that show (every).' },
  seed: { value: 1, min: 0, max: 99, step: 1, label: 'Seed',
    help: 'By region, for random: which arrangement of regions. Each seed is different, always the same.' },
};

// Whether region i is one Pick shows: 1 or 0.
function picked(i, P) {
  const n = round(P.index), pick = P.pick;
  if (i < 0) return 0;
  if (pick === 'even' || pick === 'odd') return +(i % 2 === (pick === 'odd' ? 1 : 0));
  if (pick === 'one') return +(i === n % regions(P.rule, P.size));
  return pick === 'every' ? +(i % max(1, n) === 0) : 1;
}

// How much of q's pane shows by region: its petal and ring (off the rose, from the angle and the distance from the
// layer's centre), softened toward the next petal's over Softness of the pane.
const at = { sector: 0, ring: 1 };
function inside(q, P) {
  const s = q.sector >= 0 ? q.sector : floor(fract(q.a + 1 / 32) * 16), u = fract(q.a * 16 + 0.5);
  at.sector = s; at.ring = q.ring > 0 ? q.ring : min(7, floor(q.r * 7) + 1);
  const m = picked(region(at, P.rule, P.size, P.seed), P), e = 2 * abs(u - 0.5);
  if (e <= 1 - P.softness) return m;
  at.sector = (s + (u < 0.5 ? 15 : 1)) % 16;
  return mix(m, picked(region(at, P.rule, P.size, P.seed), P), 0.5 * (e - 1 + P.softness) / P.softness);
}

function filter(c, q, t, P, G, x) {
  let m;
  if (P.by === 'region') m = inside(q, P);
  else {
    const s = P.by === 'self' ? c : x;
    if (!s) return c;
    const b = (P.by === 'self' ? 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2] : max(s[0], s[1], s[2])) * s[3];
    m = smoothstep(P.cutoff - P.softness / 2, P.cutoff + P.softness / 2, b);
  }
  if (P.invert) m = 1 - m;
  c[3] *= 1 - P.amount * (1 - m);        // c is the chain's colour: change it and hand it back
  return c;
}
