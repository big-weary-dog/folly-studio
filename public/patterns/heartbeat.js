// Heartbeat: Colours swell out in Direction, lub-dub, every two beats of the look's tempo (60 a minute at 120 bpm),
// peaking in the last colour. Spread is how long a beat takes to cross the layer.
const params = {
  colours: { value: 'low body high', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours each beat as it swells, from faint to its peak in the last colour.' },
  direction: { value: 'out', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left', 'back', 'front', 'out', 'in'],
    help: 'Which way each beat travels; out swells from the middle of the LEDs, in closes toward it.' },
  spread: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Spread (seconds)',
    help: 'How long a beat takes to cross the layer. 0 beats everywhere at once; high ripples it across.' },
};

function pixel(p, t, P, G) {
  // out and in: from the LEDs' middle
  const d = P.direction, r = p.sr > 0 ? hypot(p.Y - p.cy, p.Z - p.cz) / p.sr : 0;
  const ph = beat(t - (d === 'out' ? r : d === 'in' ? 1 - r : toward(p, d)) * P.spread, G.bpm / 2);
  const v = max(pulse(ph, 0.15), 0.7 * pulse(ph - 0.24, 0.15));
  if (v < 0.004) return null;
  const c = pal('colours', v);
  c[3] = v;
  return c;
}
