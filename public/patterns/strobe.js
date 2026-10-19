// Strobe: flashes the layer at Speed, each flash the next of Colours; 2 a second by default, and over 3 a second on a
// large area fails the flash check. Length is the lit share of each flash; Scatter flashes only part of the layer.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours' },
  speed: { value: 2, min: 0.25, max: 8, step: 0.25, label: 'Speed (flashes a second; over 3 fails the flash check)' },
  length: { value: 0.15, min: 0.05, max: 0.5, step: 0.01, label: 'Length' },
  scatter: { value: 0, min: 0, max: 1, step: 0.01, label: 'Scatter' },
  fade: { value: 0.04, min: 0, max: 0.25, step: 0.01, label: 'Fade out (share of each flash)' },
};

function pixel(p, t, P) {
  const x = clock('speed'), n = floor(x), s = min(P.fade, P.length);
  if (P.scatter > 0 && rand(p.k, n) < P.scatter * 0.9) return null;
  const on = 1 - soft(P.length - s / 2, x - n, s);          // full on the beat, fading out by the end of Length
  if (on <= 0.002) return null;
  const c = swatch('colours', n);
  c[3] = on;
  return c;
}
