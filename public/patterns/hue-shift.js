// Hue shift: turns the colours above it round the colour wheel (brightness kept) by place along Direction: Spread
// is turns across the layer, Speed turns a second, Offset a fixed turn (0.5 the opposite hue). One colour becomes a
// rainbow.
const params = {
  direction: { value: 'right', type: 'choice', options: DIRECTIONS, label: 'Direction',
    help: 'Which way the rainbow runs across the layer, and which way it moves when Speed is set.' },
  spread: { value: 0.5, min: -2, max: 2, step: 0.01, label: 'Spread (turns across)',
    help: 'How far the hue turns from side to side. Zero shifts every light alike; high packs in more rainbows.' },
  offset: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Offset (turns)',
    help: 'A fixed turn added everywhere. Zero keeps the colours; 0.5 gives each its opposite hue.' },
  speed: { value: 0.05, min: -1, max: 1, step: 0.01, label: 'Speed (turns a second)',
    help: 'How fast the hues roll round the wheel. Zero holds still; negative rolls the other way.' },
};

function filter(c, q, t, P) {
  const turn = TAU * (toward(q, P.direction) * P.spread + P.offset + clock('speed'));
  const cs = cos(turn), s = sin(turn) / sqrt(3), k = (1 - cs) / 3;
  const r = c[0], g = c[1], b = c[2];
  c[0] = clamp(r * (cs + k) + g * (k - s) + b * (k + s));
  c[1] = clamp(r * (k + s) + g * (cs + k) + b * (k - s));
  c[2] = clamp(r * (k - s) + g * (k + s) + b * (cs + k));
  return c;
}
