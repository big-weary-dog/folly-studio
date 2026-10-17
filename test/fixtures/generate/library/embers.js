// Rising embers: warm sparks drift up every surface.
const params = {
  speed: { value: 0.4, min: 0, max: 2 },
  color: { value: '#ff6a00', type: 'color' },
};

function pixel(p, t, P) {
  const v = pulse(fract(p.ly * 3 - t * P.speed + p.seed * 0.3), 0.2);
  return scale(P.color, 0.35 + 0.65 * v);
}
