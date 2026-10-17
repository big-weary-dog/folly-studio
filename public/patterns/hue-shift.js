// Hue shift: turns colours round the wheel (round the grey axis, so brightness holds) by place along an axis:
// across, up, front to back, round (a) or along strands (u). spread (turns over it), speed (turns a second).
const params = {
  spread: { value: 0.5, min: -2, max: 2, step: 0.01, label: 'Turns of hue across the axis' },
  axis: { value: 0, min: 0, max: 4, step: 1, label: 'Across, up, front → back, round, along' },
  speed: { value: 0.05, min: -1, max: 1, step: 0.01, label: 'Turns a second' },
};

function filter(c, q, t, P) {
  const a = round(P.axis), x = a === 0 ? q.lz : a === 1 ? q.ly : a === 2 ? q.lx : a === 3 ? q.a : q.u;
  const turn = TAU * (x * P.spread + t * P.speed), cs = cos(turn), s = sin(turn) / sqrt(3), k = (1 - cs) / 3;
  const r = c[0], g = c[1], b = c[2];
  c[0] = clamp(r * (cs + k) + g * (k - s) + b * (k + s));
  c[1] = clamp(r * (k + s) + g * (cs + k) + b * (k - s));
  c[2] = clamp(r * (k - s) + g * (k + s) + b * (cs + k));
  return c;
}
