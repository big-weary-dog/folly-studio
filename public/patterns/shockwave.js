// Shockwave: a front bursts out in Direction at Speed, fast then slowing, and fades as it goes: the last of Colours
// at its front, fading back through the rest in its wake. Put an anchor below it to burst from the rose window, in 3D
// as a sphere.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  direction: { value: 'out', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left', 'back', 'front', 'out', 'in'] },
  speed: { value: 0.5, min: 0.1, max: 2, step: 0.01, label: 'Speed (bursts a second)' },
  width: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: 'Width' },
};

function pixel(p, t, P) {
  const a = fract(clock('speed')), R = 1.2 * (1 - (1 - a) ** 3);          // how far the front has come
  const x = (R - toward(p, P.direction)) / (P.width * (0.5 + a));         // > 0 behind the front
  const v = max(exp(-x * x * 4), x > 0 ? exp(-x * 0.3) : 0), k = v * (1 - a * a * a);
  if (k < 0.004) return null;
  const c = pal('colours', v);
  c[3] = k;
  return c;
}
