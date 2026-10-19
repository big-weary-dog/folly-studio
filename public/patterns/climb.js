// Climb: colour climbs each part of Groups (p.part: each group tagged it, or each smallest group of the one that is)
// in Direction at Speed behind a head of the last colour, crowns its top and lifts away, one after another. Stagger
// is how far apart the parts start; Head its length.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours the column from its foot to its top; the last colour lights its head and crown.' },
  tag: { value: 'all', type: 'choice', label: 'Groups (tag)',
    options: ['all', 'tower', 'spire', 'spirelet', 'arch', 'arch-main', 'arch-mini', 'arch-quad', 'ring', 'rose',
      'window', 'front', 'back', 'left', 'right', 'ground-level'],
    help: 'Which tagged groups climb apart; all staggers every smallest group, and LEDs in none climb together.' },
  direction: { value: 'up', type: 'choice', options: ['up', 'down'], label: 'Direction',
    help: 'up climbs from the ground to the top; down pours from the top to the ground.' },
  speed: { value: 0.25, min: 0.05, max: 1, step: 0.01, label: 'Speed (rises a second)',
    help: 'How fast each climb comes round. Low rises slowly; high shoots up quickly.' },
  stagger: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Stagger (share of a rise)',
    help: 'How far apart the groups start. 0 climbs them all together; high scatters their starts.' },
  head: { value: 0.06, min: 0.02, max: 0.3, step: 0.01, label: 'Head',
    help: 'Length of the bright head leading the climb. Low is a sharp tip; high a long glow.' },
};

function pixel(p, t, P) {
  const y = toward(p, P.direction), ph = fract(clock('speed') - rand(p.part(P.tag), 3) * P.stagger);
  const top = smoothstep(0, 0.6, ph) * 1.1, foot = smoothstep(0.72, 1, ph) * 1.1;    // the lit column's ends
  const lit = smoothstep(top, top - 0.03, y) * smoothstep(foot - 0.03, foot, y);
  const head = max(exp(-(((y - top) / P.head) ** 2)) * (1 - foot), pulse(ph - 0.66, 0.1) * smoothstep(0.7, 1, y));
  const v = max(lit, head);
  if (v <= 0.002) return null;
  const c = mix(pal('colours', y), pal('colours', 1), head);
  c[3] = v;
  return c;
}
