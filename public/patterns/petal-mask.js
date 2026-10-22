// Petal mask: shows what is above it only on the rose's petals Petals names (1 the top one, on clockwise), with no
// input; Invert shows the other petals. Amount is how fully it hides the rest: hidden is transparent. Softness fades a
// petal's edges into its neighbours'. Off the rose a petal is the sixteenth of a turn its angle round the layer's
// centre falls in, as Mask by region.
const params = {
  petals: { value: '1-4 9-12', type: 'text', petals: true, label: 'Petals shown',
    help: 'The petals that show, 1 the top one, on clockwise: numbers and runs (3 5 9-12; 15-2 wraps). Click them.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mask strength',
    help: 'How fully the other petals are hidden. Zero hides nothing; one makes them fully transparent.' },
  softness: { value: 0.05, min: 0.01, max: 1, step: 0.01, label: 'Edge softness',
    help: 'How gradual a petal\'s edges are, a share of the petal. Low cuts at the lead lines; high fades wide.' },
  invert: { value: false, type: 'toggle', label: 'Show the other petals',
    help: 'Off shows the petals named; on hides them and shows the rest.' },
};

// Which of the 16 petals show, 1 or 0, read from Petals' text when it changes; and the rose's centre.
const on = new Float32Array(16);
let read = null, cy = 0, cz = 0;
function frame(t, P) {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
  if (P.petals === read) return;
  read = P.petals;
  on.fill(0);
  for (const w of String(read).split(/[\s,]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(w), a = m ? +m[1] : 0, b = m && m[2] ? +m[2] : a;
    if (a < 1 || a > 16 || b < 1 || b > 16) continue;
    for (let i = a - 1; ; i = (i + 1) % 16) {
      on[i] = 1;
      if (i === b - 1) break;
    }
  }
}

// How much of q shows: its petal's, softened toward the next petal's over Softness of the petal. On the rose, its
// sector and its angle round the rose's centre; off it, both from its angle round the layer's.
function filter(c, q, t, P) {
  const rose = q.sector >= 0, a = rose ? fract(atan2(q.Z - cz, q.Y - cy) / TAU) : q.a;
  const s = rose ? q.sector : floor(fract(a + 1 / 32) * 16), u = fract(a * 16 + 0.5), e = 2 * abs(u - 0.5);
  let m = on[s % 16];
  if (e > 1 - P.softness) m = mix(m, on[(s + (u < 0.5 ? 15 : 1)) % 16], 0.5 * (e - 1 + P.softness) / P.softness);
  if (P.invert) m = 1 - m;
  c[3] *= 1 - P.amount * (1 - m);        // c is the chain's colour: change it and hand it back
  return c;
}
