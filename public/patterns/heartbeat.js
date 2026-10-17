// Heartbeat: a lub-dub at a set tempo: beat(t, bpm) with two pulses, delayed by the radius r so each beat
// ripples outward; it swells from violet to heart red, white-hot at the centre, never dipping to black.
const params = {
  bpm: { value: 72, min: 30, max: 180, step: 1 },
  spread: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Seconds to reach the edge' },
  body: { value: '#7a00ff', type: 'color' },
  beat: { value: '#ff0028', type: 'color' },
  core: { value: '#ffc2d0', type: 'color' },
};

function pixel(p, t, P) {
  const ph = beat(t - p.r * P.spread, P.bpm);
  const env = max(pulse(ph, 0.1), 0.65 * pulse(ph - 0.22, 0.1));
  const c = mix(P.body, P.beat, env);
  return mix(c, P.core, smoothstep(0.85, 1, env) * (1 - p.r));
}
