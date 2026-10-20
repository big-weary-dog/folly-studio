// Shockwave: a front bursts out in Direction at Speed, fast then slowing, and fades as it goes: the last of Colours
// at its front, fading back through the rest in its wake. Put an anchor below it to burst from the rose window, in 3D
// as a sphere.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Colours the burst: its bright front takes the last colour, the wake behind fades back through the rest.' },
  direction: { value: 'out', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left', 'back', 'front', 'out', 'in'],
    help: 'Which way the front travels: up, down, across, front to back, out from the centre or in toward it.' },
  speed: { value: 0.5, min: 0.1, max: 2, step: 0.01, label: 'Speed (bursts a second)',
    help: 'How often a burst goes off. Low gives slow rolling booms; high fires them in quick succession.' },
  width: { value: 0.12, min: 0.02, max: 0.5, step: 0.01, label: 'Width',
    help: 'How thick the front is (it thickens as it travels). Low is a crisp thin shell; high a broad soft surge.' },
};

function pixel(p, t, P) {
  const a = fract(clock('speed')), R = 1.2 * (1 - (1 - a) ** 3);          // how far the front has come
  const x = (R - toward(p, P.direction)) / (P.width * (0.5 + a));         // > 0 behind the front
  const v = max(exp(-x * x * 4), x > 0 ? exp(-x * 1.5) : 0), k = v * (1 - a) ** 2;      // a short wake
  if (k < 0.004) return null;
  const c = pal('colours', v);
  c[3] = k;
  return c;
}
