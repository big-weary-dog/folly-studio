// Heartbeat: Colours swell out in Direction, lub-dub, every two beats of the look's tempo (60 a minute at 120 bpm),
// peaking in the last colour. Spread is how long a beat takes to cross the layer.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  direction: { value: 'out', type: 'choice', options: DIRECTIONS, label: 'Direction' },
  spread: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Spread (seconds)' },
};

function pixel(p, t, P, G) {
  const ph = beat(t - toward(p, P.direction) * P.spread, G.bpm / 2);
  const v = max(pulse(ph, 0.1), 0.65 * pulse(ph - 0.22, 0.1));
  if (v < 0.004) return null;
  const c = pal('colours', v);
  c[3] = v;
  return c;
}
