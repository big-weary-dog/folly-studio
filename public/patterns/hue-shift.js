// Hue shift: turns the colours above it round the colour wheel (brightness kept) by place along Direction: Spread
// is turns across the layer, Speed turns a second. One colour becomes a rainbow.
const params = {
  direction: { value: 'right', type: 'choice', options: DIRECTIONS, label: 'Direction' },
  spread: { value: 0.5, min: -2, max: 2, step: 0.01, label: 'Spread (turns across)' },
  speed: { value: 0.05, min: -1, max: 1, step: 0.01, label: 'Speed (turns a second)' },
};

function filter(c, q, t, P) {
  const turn = TAU * (toward(q, P.direction) * P.spread + clock('speed'));
  const cs = cos(turn), s = sin(turn) / sqrt(3), k = (1 - cs) / 3;
  const r = c[0], g = c[1], b = c[2];
  c[0] = clamp(r * (cs + k) + g * (k - s) + b * (k + s));
  c[1] = clamp(r * (k + s) + g * (cs + k) + b * (k - s));
  c[2] = clamp(r * (k - s) + g * (k + s) + b * (cs + k));
  return c;
}
