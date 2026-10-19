// Fire: flames rise in Direction at Speed from the layer's edge, hottest at their roots in the last of Colours,
// cooling through the rest to clear at their tips. Height is how far they reach; Size a flame's, as a share of the
// layer.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  direction: { value: 'up', type: 'choice', options: ['up', 'down', 'right', 'left'], label: 'Direction' },
  speed: { value: 1.2, min: 0, max: 4, step: 0.05, label: 'Speed (flickers a second)' },
  height: { value: 0.75, min: 0.2, max: 1.5, step: 0.01, label: 'Height' },
  size: { value: 0.33, min: 0.12, max: 2, step: 0.01, label: 'Size (share of the layer)' },
};

function pixel(p, t, P) {
  const s = 1 / P.size, d = P.direction, y = toward(p, d), across = d === 'right' || d === 'left' ? p.ly : p.lz;
  const w = clock('speed'), h = fbm(across * s, y * s * 1.4 - w, p.lx * s + w * 0.17);
  const heat = clamp(h * 1.6 - y / P.height + 0.25);
  if (heat <= 0.01) return null;
  const c = pal('colours', heat);
  c[3] = smoothstep(0, 0.35, heat);
  return c;
}
