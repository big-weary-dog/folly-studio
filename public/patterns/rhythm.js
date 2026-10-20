// Rhythm: plays what is above it as a drum part locked to the look's bpm. Pattern is a line of steps, X a loud hit,
// x a hit, . a rest; several lines (split by spaces) go to Tag's places in turn, or with several tags, line i to the
// i-th tag. Each hit lights it and fades over Decay; Amount is how dark between hits, Invert cuts it out on hits.
// A line with over three hits in a second only dips on them, so a busy part shimmers rather than strobes.
const params = {
  pattern: { value: 'X...x...X...x...', type: 'text', label: 'Pattern',
    help: 'Steps of the beat: X a loud hit, x a hit, . a rest. Lines split by spaces go to the places in turn.' },
  tag: { value: 'all', type: 'text', label: 'Tag',
    help: 'Which places the lines go to: one tag deals them to its parts; several (tower arch rose), one each.' },
  steps: { value: 4, min: 1, max: 4, step: 1, label: 'Steps (a beat)',
    help: 'How many steps make a beat: 4 is sixteenth notes at the look tempo, 1 a step a beat.' },
  swing: { value: 0, min: 0, max: 1, step: 0.01, label: 'Swing',
    help: 'How late every second step lands. 0 is straight; 1 pushes it to three quarters of its pair, a shuffle.' },
  decay: { value: 0.25, min: 0.02, max: 2, step: 0.01, label: 'Decay (seconds)',
    help: 'How long a hit takes to fade. Low is a tight tick; high rings on into the next hit.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount',
    help: 'How dark it goes between hits. 1 gates it to black; 0.3 to 0.5 pumps a bed; 0 leaves it as it was.' },
  invert: { value: false, type: 'toggle', label: 'Invert',
    help: 'On cuts the look out on each hit and lets it back between; off lights it on the hits.' },
};

const BUSY = 3, DIP = 0.25;   // over BUSY hits in any second (the flash check's limit): DIP of the depth
let text = null, lines = [], tags = [], timed = '';
const env = new Float64Array(64), depth = new Float64Array(64);

function parse(P) {
  text = P.pattern + '\n' + P.tag;
  lines = P.pattern.split(/\s+/).filter(Boolean).slice(0, 64)
    .map((l) => [...l].map((ch) => (ch === 'X' ? 1 : ch === 'x' ? 0.6 : 0)));
  tags = P.tag.split(/\s+/).filter(Boolean).slice(0, 16);
}

// Step j's onset, in steps: odd steps late by swing.
const onset = (j, late) => j - (j & 1) + (j & 1 ? late : 0);

// The most hits of line L in any second (from each hit, those within the next second, round the loop).
function busiest(L, per, late) {
  const n = L.length, hits = [];
  for (let s = 0; s < 2 * n; s++) if (L[s % n] > 0) hits.push(onset(s, late) * per);
  let most = 0;
  for (let a = 0, b = 0; a < hits.length / 2; a++) {
    while (b < hits.length && hits[b] - hits[a] < 1) b++;
    most = max(most, b - a);
  }
  return most;
}

function frame(t, P, G) {
  if (text !== P.pattern + '\n' + P.tag) { parse(P); timed = ''; }
  const per = 60 / (G.bpm * P.steps), late = 1 + 0.5 * P.swing, pos = t / per;
  if (timed !== per + ' ' + late) {
    timed = per + ' ' + late;
    for (let i = 0; i < lines.length; i++) depth[i] = busiest(lines[i], per, late) > BUSY ? DIP : 1;
  }
  let j = floor(pos);
  if (j & 1 && pos - (j - 1) < late) j--;            // a late odd step: still on the even one before it
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i], n = L.length;
    let a = j;                                          // the last hit at or before step j
    while (a > j - n && !(L[((a % n) + n) % n] > 0)) a--;
    if (a === j - n) { env[i] = 1 - depth[i]; continue; }
    const k = max(0, 1 - (pos - onset(a, late)) * per / P.decay);
    env[i] = 1 - depth[i] * (1 - L[((a % n) + n) % n] * k * k);
  }
}

function filter(c, q, t, P) {
  const m = lines.length;
  if (!m) return c;
  let i = 0;
  if (tags.length > 1) {
    while (i < tags.length && !q.is(tags[i])) i++;
    if (i === tags.length) return c;
  } else if (m > 1 || (tags[0] && tags[0] !== 'all')) {
    i = q.part(tags[0] || 'all');         // its parts in turn; a place outside the tag is left as it is
    if (i < 0) return c;
  }
  const e = env[i % m];
  c[3] *= P.invert ? 1 - P.amount * e : 1 - P.amount * (1 - e);
  return c;
}
