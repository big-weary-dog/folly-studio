// Groups in turn: the parts of Tag (each group tagged it, or each smallest group of the one that is: each arch of
// the arches) light one after another at Speed, each filling along its wire behind a head of the last colour (Fill
// wipe) or all at once (flash), then fading. Order goes first to last, back, or to and fro.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours each group along its wire as it fills; the last colour lights the moving head.' },
  tag: { value: 'arch', type: 'choice', label: 'Groups (tag)',
    options: ['arch', 'arch-main', 'arch-mini', 'arch-quad', 'tower', 'spire', 'spirelet', 'ring', 'rose', 'window',
      'front', 'back', 'left', 'right', 'ground-level', 'all'],
    help: 'Which of the rig\'s tagged groups take turns; a tag on one group (the arches) steps through its parts.' },
  fill: { value: 'wipe', type: 'choice', options: ['wipe', 'flash'], label: 'Fill',
    help: 'wipe fills each group along its wire behind a bright head; flash lights the whole group at once.' },
  order: { value: 'forward', type: 'choice', options: ['forward', 'back', 'bounce'], label: 'Order',
    help: 'forward goes first to last and round; back goes last to first; bounce goes to and fro.' },
  speed: { value: 1, min: 0.25, max: 6, step: 0.05, label: 'Speed (groups a second)',
    help: 'How fast the turn passes from group to group. Low steps slowly; high races round.' },
  fade: { value: 1.5, min: 0.2, max: 6, step: 0.1, label: 'Fade (turns)',
    help: 'How long a lit group takes to die away. Low snaps off behind the head; high leaves a long glowing trail.' },
};

function pixel(p, t, P) {
  const g = p.part(P.tag), n = p.parts(P.tag);
  if (g < 0) return null;
  const x = clock('speed'), turn = floor(x), f = x - turn, head = f * 1.3, m = max(1, 2 * n - 2);
  const at = P.order === 'back' ? n - 1 - g : g;
  let age = (((turn - at) % n) + n) % n + f;                   // turns since this group's began
  if (P.order === 'bounce') age = min((((turn - g) % m) + m) % m, (((turn - (m - g) % m) % m) + m) % m) + f;
  const lit = age >= 1 ? exp(-(age - 1) / P.fade) : P.fill === 'flash' ? 1 : smoothstep(head, head - 0.05, p.u);
  if (lit < 0.004) return null;
  const c = age < 1 && P.fill === 'wipe' ? mix(pal('colours', p.u), pal('colours', 1), exp(-((p.u - head) ** 2) * 600))
    : pal('colours', P.fill === 'flash' ? g / max(1, n - 1) : p.u);
  c[3] = lit;
  return c;
}
