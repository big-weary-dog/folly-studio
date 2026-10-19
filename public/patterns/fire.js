// Fire: flames rise in Direction at Speed from the layer's edge, hottest at their roots in the last of Colours,
// cooling through the rest into Tips, the colour of their tips and of the embers that rise above them. Height is how
// far they reach; Size a flame's, as a share of the layer; Embers how many rise.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  tips: { value: 'high', type: 'color', label: 'Tips and embers', blend: 'smooth' },
  direction: { value: 'up', type: 'choice', options: ['up', 'down', 'right', 'left'], label: 'Direction' },
  speed: { value: 1.2, min: 0, max: 4, step: 0.05, label: 'Speed (flickers a second)' },
  height: { value: 0.75, min: 0.2, max: 1.5, step: 0.01, label: 'Height' },
  size: { value: 0.33, min: 0.12, max: 2, step: 0.01, label: 'Size (share of the layer)' },
  embers: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Embers' },
};

function pixel(p, t, P) {
  const s = 1 / P.size, d = P.direction, y = toward(p, d), across = d === 'right' || d === 'left' ? p.ly : p.lz;
  const w = clock('speed'), h = fbm(across * s, y * s * 1.4 - w, p.lx * s + w * 0.17);
  const heat = clamp(h * 1.6 - y / P.height + 0.25);
  if (heat <= 0.01) {                       // above the flames: embers drift up, faster than the flames, and die out
    const e = noise(across * s * 5, y * s * 3 - w * 2, p.lx * s * 5) + (P.embers - 1) * 0.35;
    const v = smoothstep(0.6, 0.75, e) * (1 - smoothstep(0, P.height * 1.3, y));
    if (v <= 0.01) return null;
    const c = pal('tips', 1 - v);
    c[3] = v;
    return c;
  }
  const c = mix(pal('tips', heat), pal('colours', heat), smoothstep(0.1, 0.45, heat));    // the tips, then the flame
  c[3] = smoothstep(0, 0.35, heat);
  return c;
}
