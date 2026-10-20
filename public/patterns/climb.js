// Climb: light climbs each part of Groups (p.part: each group tagged it, or each smallest group of the one that is)
// from its own foot to its own top in Direction behind a bright head, crowns the top and lifts away. The parts start
// one after another in rig order, spread over Stagger of a rise. Colour by Age: light is born the last of Colours at
// the head and walks back to the first as it ages; Along: Colours run along each strand. Head is the tip's length.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'The palette of the climb: the head is the last colour; the light behind it walks back as it ages.' },
  tag: { value: 'all', type: 'choice', label: 'Groups (tag)',
    options: ['all', 'tower', 'spire', 'spirelet', 'arch', 'arch-main', 'arch-mini', 'arch-quad', 'ring', 'rose',
      'window', 'front', 'back', 'left', 'right', 'ground-level'],
    help: 'Which tagged groups climb, each its own height; all climbs every smallest group, LEDs in none together.' },
  by: { value: 'age', type: 'choice', options: ['age', 'along'], label: 'Colour by (age, along strand)',
    help: 'age: light cools from the last colour back to the first as it ages; along: Colours run along each strand.' },
  direction: { value: 'up', type: 'choice', options: ['up', 'down'], label: 'Direction',
    help: 'up climbs from each group\'s foot to its top; down pours from its top to its foot.' },
  speed: { value: 0.25, min: 0.05, max: 1, step: 0.01, label: 'Speed (rises a second)',
    help: 'How fast each climb comes round. Low rises slowly; high shoots up quickly.' },
  stagger: { value: 0.6, min: 0, max: 1, step: 0.01, label: 'Stagger (share of a rise the starts spread over)',
    help: 'How far apart the groups start, in order. 0 climbs them all together; 1 spreads them over a whole rise.' },
  head: { value: 0.06, min: 0.02, max: 0.3, step: 0.01, label: 'Head (share of a group\'s height)',
    help: 'Length of the bright head leading the climb. Low is a sharp tip; high a long glow.' },
};

function pixel(p, t, P) {
  const up = p.partUp(P.tag), y = P.direction === 'down' ? 1 - up : up;
  const ph = fract(clock('speed') - max(0, p.part(P.tag)) / max(1, p.parts(P.tag)) * P.stagger);
  const top = smoothstep(0, 0.6, ph) * 1.1, foot = smoothstep(0.72, 1, ph) * 1.1;    // the lit column's ends
  const lit = smoothstep(top, top - 0.03, y) * smoothstep(foot - 0.03, foot, y);
  const head = max(exp(-(((y - top) / P.head) ** 2)) * (1 - foot), pulse(ph - 0.66, 0.1) * smoothstep(0.7, 1, y));
  const v = max(lit, head);
  if (v <= 0.002) return null;
  const age = clamp((top - y) / 1.1 + max(0, ph - 0.6) * 2);                  // 0 as the head passes, 1 old
  const c = mix(pal('colours', P.by === 'along' ? p.u : 1 - age), pal('colours', 1), head);
  c[3] = v;
  return c;
}
