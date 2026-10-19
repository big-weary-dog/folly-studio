// Butterfly: mirrored wings flow at Speed, banded back and forth through Colours.
// Zoom is how busy the wings are; Bands how many times they walk the colours.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  speed: { value: 0.6, min: 0, max: 3, step: 0.01, label: 'Speed' },
  scale: { value: 2, min: 0.5, max: 6, step: 0.1, label: 'Zoom (more is busier)' },
  bands: { value: 1.5, min: 0.25, max: 6, step: 0.05, label: 'Bands' },
};

// xLights' wings: |(x² − y²)·sin(s + (x + y)π)| / (x² + y²), x folded so both sides match.
function pixel(p, t, P) {
  const s = clock('speed'), x = abs(p.lz - 0.5) * 2 * P.scale + 0.05, y = (p.ly - 0.45) * 2 * P.scale + p.lx - 0.5;
  const n = abs((x * x - y * y) * sin(s + (x + y) * PI)) / (x * x + y * y + 0.1);
  return pal('colours', tri(n * P.bands + s * 0.1));
}
