// Heartbeat: the whole building swells on a double beat.
const params = {
  bpm: { value: 72, min: 30, max: 180 },
  color: { value: '#ff0020', type: 'color' },
  low: { value: '#8000ff', type: 'color' },
};

function pixel(p, t, P) {
  const ph = beat(t, P.bpm);
  const v = max(pulse(ph, 0.08), 0.7 * pulse(ph - 0.18, 0.08));
  return mix(P.low, P.color, v);
}
