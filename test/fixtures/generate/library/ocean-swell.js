// Ocean swell: long waves roll front to back between two blues.
const params = {
  speed: { value: 0.25, min: 0, max: 2 },
  color: { value: '#0040ff', type: 'color' },
  color2: { value: '#00ffd8', type: 'color' },
};

function pixel(p, t, P) {
  const k = wave(p.lx * 1.5 + 0.3 * sin(TAU * (p.ly + t * 0.1)) - t * P.speed);
  return mix(P.color, P.color2, k);
}
