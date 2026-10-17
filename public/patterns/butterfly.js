// Butterfly: xLights' wings, |(x² − y²)·sin(s + (x + y)π)| / (x² + y²) with x folded so both match, through
// body colours with accent veins. speed (flutter, plus energy), scale (zoom), chunks (bands), veins.
const params = {
  speed: { value: 0.6, min: 0, max: 3, step: 0.01 },
  scale: { value: 2, min: 0.5, max: 6, step: 0.1, label: 'Zoom (bigger is busier)' },
  chunks: { value: 1.5, min: 0.25, max: 6, step: 0.05, label: 'Colour bands' },
  veins: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Accent veins' },
};

let s = 0, last = 0;
function frame(t, P, G) {
  const dt = t - last, k = P.speed * (0.5 + G.energy);
  s = dt >= 0 && dt < 1 ? s + dt * k : t * k;
  last = t;
}

function pixel(p, t, P) {
  const x = abs(p.lz - 0.5) * 2 * P.scale + 0.05, y = (p.ly - 0.45) * 2 * P.scale + p.lx - 0.5;
  const n = abs((x * x - y * y) * sin(s + (x + y) * PI)) / (x * x + y * y + 0.1);
  const v = n * P.chunks + s * 0.1;
  return mix(pal('body', tri(v)), pal('accent', fract(v)), pulse(v * 2, 0.12) * P.veins);
}
