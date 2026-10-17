// Galaxy: spiral arms wheel round a highlight core by a and r round the layer's centre, accent near the core,
// body at the rim (xLights). speed (turns a second, plus energy), arms, twist (turns core to rim), width.
const params = {
  speed: { value: 0.1, min: -1, max: 1, step: 0.01, label: 'Turns a second' },
  arms: { value: 3, min: 1, max: 8, step: 1 },
  twist: { value: 1.2, min: -4, max: 4, step: 0.05, label: 'Wind (turns from core to rim)' },
  width: { value: 0.3, min: 0.05, max: 0.5, step: 0.01, label: 'Arm width' },
};

let spin = 0, last = 0;
function frame(t, P, G) {
  const dt = t - last, k = P.speed * (0.5 + G.energy);
  spin = dt >= 0 && dt < 1 ? spin + dt * k : t * k;
  last = t;
}

function pixel(p, t, P) {
  const arm = pulse((p.a - p.r * P.twist - spin) * P.arms, P.width) * (1 - 0.4 * p.r);
  const glow = mix(pal('accent', p.r), pal('body', p.r), smoothstep(0.2, 0.8, p.r));
  const c = mix(pal('low', p.r), glow, arm);
  return mix(c, pal('high'), exp(-p.r * p.r * 60));
}
