// Rose bloom: rings open outward from the centre of the rose window, petal by petal.
const params = {
  speed: { value: 0.3, min: 0, max: 2 },
  color: { value: '#ff00c0', type: 'color' },
  color2: { value: '#ffb000', type: 'color' },
};

function pixel(p, t, P) {
  const ring = p.row > 0 ? p.row / 7 : p.r;
  const k = wave(ring - t * P.speed + (p.petal >= 0 ? p.petal / 16 : p.a) * 0.25);
  return mix(P.color, P.color2, k);
}
