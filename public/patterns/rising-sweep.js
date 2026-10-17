// Rising sweep: bands of colour climb every surface like a tide of light.
//
// A level plane rises through whatever the layer lands on (ly is height across the layer's
// own pixels), trading the base colour for the sweep colour as it passes. Nothing goes dark:
// the movement is colour moving. Turn Width down for thin bars, Bands up for several at once.
const params = {
  speed: { value: 0.25, min: 0, max: 2, step: 0.01, label: 'Sweeps per second' },
  bands: { value: 1, min: 1, max: 6, step: 1, label: 'Bands at once' },
  width: { value: 0.5, min: 0.02, max: 1, step: 0.01, label: 'Bar width' },
  base: { value: '#2a00ff', type: 'color' },
  sweep: { value: '#ff1f6a', type: 'color' },
  down: { value: false, type: 'toggle', label: 'Fall instead of rise' },
};

function pixel(p, t, P) {
  const h = P.down ? 1 - p.ly : p.ly;
  // Distance from the nearest bar centre, in bands: 0 on the centre line, 0.5 between bars.
  const d = abs(fract(h * P.bands - t * P.speed + 0.5) - 0.5);
  const half = P.width / 2;
  const k = 1 - smoothstep(half - 0.04, half + 0.04, d);
  return mix(P.base, P.sweep, k);
}
