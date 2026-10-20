// Spot: a round spot at the middle of the layer's LEDs, the last of Colours at its heart fading through the rest to
// its edge; put an anchor below it to move it. Size is its radius as a share of the layer; Softness fades its edge.
const params = {
  colours: { value: 'accent', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Colours the spot: the last colour at its heart, fading through the earlier ones toward its edge.' },
  size: { value: 0.3, min: 0.01, max: 1, step: 0.01, label: 'Size (radius, share of the layer)',
    help: 'How big the spot is. Low is a small dot; 1 spreads it across the whole layer.' },
  softness: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Softness (share of the size)',
    help: 'How far in its edge starts to fade. 0 is a hard-edged disc; 1 fades all the way from the centre.' },
};

function pixel(p, t, P) {
  // 0 at its centre (the LEDs' middle), 1 at its edge
  const d = p.sr > 0 ? hypot(p.Y - p.cy, p.Z - p.cz) / (p.sr * P.size) : 0;
  const cover = 1 - smoothstep(1 - P.softness, 1, d);
  if (cover <= 0) return null;
  const c = pal('colours', 1 - d);
  c[3] = cover;
  return c;
}
