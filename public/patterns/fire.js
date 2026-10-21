// Fire: flames rise up at Speed from the layer's bottom edge, hottest at their roots in the last of Colours,
// cooling through the rest into Tips, the colour of their tips and of the embers that rise above them. Height is how
// far they reach; Size a flame's, as a share of the layer; Embers how many rise.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours the flames, from their cooler upper reaches to their hottest roots.' },
  tips: { value: 'high', type: 'color', label: 'Tips and embers', blend: 'smooth',
    help: 'Which palette colours the tips of the flames and the embers that rise above them.' },
  speed: { value: 1.2, min: 0, max: 4, step: 0.05, label: 'Speed (flickers a second)',
    help: 'How fast the flames flicker and climb. 0 freezes them; high is a fierce, fast blaze.' },
  height: { value: 0.45, min: 0.2, max: 1.5, step: 0.01, label: 'Height',
    help: 'How far the flames reach across the layer. Low keeps them near their edge; high licks past it.' },
  size: { value: 0.33, min: 0.12, max: 2, step: 0.01, label: 'Size (share of the layer)',
    help: 'How big each tongue of flame is. Small gives a busy flicker; large gives broad, rolling flames.' },
  embers: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Embers',
    help: 'How many embers rise above the flames. 0 has none; 1 fills the air with sparks.' },
};

function pixel(p, t, P) {
  const s = 1 / P.size, y = p.ly, across = p.lz;
  const w = clock('speed'), h = fbm(across * s, y * s * 1.4 - w, p.lx * s + w * 0.17);
  const heat = clamp(h * 1.6 - y / P.height + 0.25);
  if (heat <= 0.01) {                       // above the flames: embers rise up lanes as glints, dying out by `top`
    const top = min(1, 2.5 * P.height), lane = floor(across * 24), e = rand(lane, 5) + w * 0.4 - y * 2;
    if (y > top || rand(lane, round(e), 6) > P.embers * 0.6) return null;
    const v = pulse(e, 0.08) * (1 - smoothstep(top * 0.5, top, y));
    if (v <= 0.01) return null;
    const c = pal('tips', 1 - v);
    c[3] = v;
    return c;
  }
  const c = mix(pal('tips', heat), pal('colours', heat), smoothstep(0.1, 0.45, heat));    // the tips, then the flame
  c[3] = smoothstep(0, 0.35, heat);
  return c;
}
