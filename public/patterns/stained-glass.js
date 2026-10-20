// Stained glass: colours each pane of the rose (one LED a pane: p.sector its petal, p.ring its ring) by a Rule, each
// pane one of Colours, lit from behind: Backlight plus the brightness of what is above it. Leading darkens a pane
// where the next petal's pane is another colour; Motion makes the light glow pane by pane or sweep across.
// Off the rose, panes come from the angle and the distance from the layer's centre.
const params = {
  rule: { value: 'petal', type: 'choice', label: 'Rule',
    options: ['petal', 'alternate', 'ring', 'rings', 'centre', 'spiral', 'wedges', 'checker', 'gradient', 'random'],
    help: 'Which panes share a colour: by petal, ring, heart and rim, spiral, wedge, checker, gradient or random.' },
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'The glass: each pane takes one of these, in turn by the rule (a gradient runs through them heart to rim).' },
  petals: { value: 2, min: 1, max: 8, step: 1, label: 'Petals a pane',
    help: 'For wedges, spiral and checker: how many petals one colour spans. 1 is fine; 4 gives four big wedges.' },
  seed: { value: 1, min: 0, max: 99, step: 1, label: 'Seed',
    help: 'For random: which arrangement of colours. Each seed is a different window, always the same.' },
  leading: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Leading',
    help: 'How dark the lead lines between panes of different colours are. 0 none; 1 the edge panes go dark.' },
  backlight: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Backlight',
    help: 'Light behind the glass with nothing above it. 0: the glass shows only what is above, tinted.' },
  motion: { value: 'none', type: 'choice', label: 'Motion', options: ['none', 'glow', 'sweep'],
    help: 'none holds still; glow breathes each pane in its own time; sweep passes a band of sun across.' },
  speed: { value: 0.1, min: 0, max: 1, step: 0.01, label: 'Speed',
    help: 'How fast the glow breathes or the sweep crosses, in cycles a second. 0.05–0.2 is gentle.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount',
    help: 'How much glass. 0 leaves what is above as it was; 1 is all glass.' },
};

// Which pane colour a petal s on ring j (0 the heart) takes.
function pane(rule, s, j, w, seed) {
  if (rule === 'petal') return s;
  if (rule === 'alternate') return s % 2;
  if (rule === 'ring') return j;
  if (rule === 'rings') return j % 2;
  if (rule === 'centre') return j < 1 ? 0 : j < 4 ? 1 : 2;
  if (rule === 'spiral') return floor((s + j) / w);
  if (rule === 'wedges') return floor(s / w);
  if (rule === 'checker') return (floor(s / w) + j) % 2;
  return floor(hash(s * 7 + j * 131 + seed * 977) * 64);
}

const out = [0, 0, 0, 1];

function filter(c, q, t, P) {
  const s = q.sector >= 0 ? q.sector : floor(fract(q.a + 1 / 32) * 16);
  const j = q.ring > 0 ? q.ring - 1 : min(6, floor(q.r * 7)), u = fract(q.a * 16 + 0.5);
  const rule = P.rule, w = P.petals, i = pane(rule, s, j, w, P.seed);
  const glass = rule === 'gradient' ? pal('colours', j / 6) : swatch('colours', i);
  let light = clamp(P.backlight + (c[0] + c[1] + c[2]) / 3 * c[3]);
  if (P.motion === 'glow') light *= 0.65 + 0.35 * wave(clock('speed') + hash(i * 13 + j * 5));
  if (P.motion === 'sweep') light *= 0.6 + 0.8 * band(fract(q.lz * 0.6 - clock('speed')), 0.3, 0.12, 0.2);
  // An edge pane (the left or right of its petal) under a lead line when the neighbouring petal's glass differs.
  const side = u < 0.3 ? -1 : u > 0.7 ? 1 : 0;
  if (side && rule !== 'gradient' && pane(rule, (s + side + 16) % 16, j, w, P.seed) !== i) light *= 1 - P.leading;
  const a = c[3] > 0 || P.backlight > 0 ? P.amount : 0;
  for (let k = 0; k < 3; k++) out[k] = mix(c[k], glass[k] * light, a);
  out[3] = mix(c[3], 1, a);
  return out;
}
