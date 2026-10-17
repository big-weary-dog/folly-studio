// Pinwheel: vanes of body and accent colour turn round the layer's centre from a highlight hub. speed (turns
// a second, plus energy), vanes, twist (turns from hub to rim), soft.
const params = {
  speed: { value: 0.15, min: -2, max: 2, step: 0.01, label: 'Turns a second' },
  vanes: { value: 6, min: 2, max: 16, step: 1 },
  twist: { value: 0.3, min: -2, max: 2, step: 0.01, label: 'Curve (turns from hub to rim)' },
  soft: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Edge softness' },
};

let spin = 0, last = 0;
function frame(t, P, G) {
  const dt = t - last, k = P.speed * (0.5 + G.energy);
  spin = dt >= 0 && dt < 1 ? spin + dt * k : t * k;
  last = t;
}

// The i-th band: body and accent colours in turn, spread along each role.
const swatch = (i) => pal(i & 1 ? 'accent' : 'body', fract(i * 0.618));

function pixel(p, t, P, G) {
  const n = round(P.vanes), s = fract(p.a + p.r * P.twist - spin) * n, i = floor(s);
  const c = mix(swatch(i), swatch((i + 1) % n), smoothstep(1 - P.soft, 1, s - i));
  return mix(c, pal('high'), smoothstep(0.12, 0.03, p.r));
}
