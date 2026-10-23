// Hue shift: rotates RGB hues equally everywhere; clipping can change brightness. Greys stay unchanged.
// Offset is a fixed turn (0.5 the opposite hue), Speed turns a second.
const params = {
  offset: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: 'Offset (turns)',
    help: 'Fixed RGB hue turn: 0 keeps colours; 0.5 gives opposites. Greys stay; brightness can change.' },
  speed: { value: 0.05, min: -1, max: 1, step: 0.01, label: 'Speed (turns a second)',
    help: 'How fast the hues roll round the wheel. Zero holds still; negative rolls the other way.' },
};

function filter(c, q, t, P) {
  const turn = TAU * (P.offset + clock('speed'));
  const cs = cos(turn), s = sin(turn) / sqrt(3), k = (1 - cs) / 3;
  const r = c[0], g = c[1], b = c[2];
  c[0] = clamp(r * (cs + k) + g * (k - s) + b * (k + s));
  c[1] = clamp(r * (k + s) + g * (cs + k) + b * (k - s));
  c[2] = clamp(r * (k - s) + g * (k + s) + b * (cs + k));
  return c;
}
