// Lighthouse: a bright beam sweeps round the façade over a deep blue sea.
const params = {
  speed: { value: 0.2, min: 0, max: 2 },
  width: { value: 0.08, min: 0.01, max: 0.5 },
  color: { value: '#ffffff', type: 'color' },
  sea: { value: '#0018ff', type: 'color' },
};

let angle = 0;
function frame(t, P) {
  angle = fract(t * P.speed);
}

function pixel(p, t, P) {
  return mix(P.sea, P.color, pulse(p.a - angle, P.width));
}
