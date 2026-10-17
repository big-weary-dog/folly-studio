// Wave: a sine, triangle or square wave rolls across the layer (lz; depth delays it), a highlight line over
// accent water and low air (xLights). speed, cycles, amp (energy lifts it), shape, thick, fill.
const params = {
  speed: { value: 0.3, min: -2, max: 2, step: 0.01, label: 'Waves a second' },
  cycles: { value: 1.5, min: 0.25, max: 8, step: 0.05, label: 'Waves across' },
  amp: { value: 0.25, min: 0, max: 0.5, step: 0.01, label: 'Amplitude' },
  shape: { value: 0, min: 0, max: 2, step: 1, label: 'Sine, triangle, square' },
  thick: { value: 0.05, min: 0.01, max: 0.3, step: 0.005, label: 'Line thickness' },
  fill: { value: true, type: 'toggle', label: 'Fill below' },
};

function pixel(p, t, P, G) {
  const ph = p.lz * P.cycles - t * P.speed + p.lx * 0.5, sh = round(P.shape), f = fract(ph);
  const w = sh === 0 ? sin(TAU * ph) : sh === 1 ? 2 * tri(ph + 0.25) - 1
    : 2 * (smoothstep(0, 0.04, f) - smoothstep(0.5, 0.54, f)) - 1;
  const d = p.ly - 0.5 - w * P.amp * (0.6 + 0.8 * G.energy);
  const c = P.fill && d < 0 ? pal('accent', clamp(-d * 2)) : pal('low', p.ly);
  return mix(c, pal('high'), smoothstep(P.thick, P.thick * 0.3, abs(d)));
}
