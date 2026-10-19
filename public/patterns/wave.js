// Wave: a line waves across the layer in Direction at Speed, a sine, triangle or square, walking Colours along it.
// Waves is how many fit across; Height is how far it swings.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  direction: { value: 'right', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left', 'back', 'front', 'out', 'in', 'round'] },
  speed: { value: 0.3, min: -2, max: 2, step: 0.01, label: 'Speed (waves a second)' },
  shape: { value: 'sine', type: 'choice', options: ['sine', 'triangle', 'square'], label: 'Shape' },
  waves: { value: 1.5, min: 0.25, max: 8, step: 0.05, label: 'Waves across' },
  height: { value: 0.25, min: 0, max: 0.5, step: 0.01, label: 'Height' },
  width: { value: 0.05, min: 0.01, max: 0.3, step: 0.005, label: 'Line width' },
};

// The coordinate the line swings in: up for right, left, back and front; across for up and down.
const across = (p, d) => (d === 'up' || d === 'down' ? p.lz : d === 'out' || d === 'in' ? p.a : d === 'round' ? p.r
  : p.ly);

function pixel(p, t, P) {
  const d = P.direction, x = toward(p, d), ph = x * P.waves - clock('speed'), f = fract(ph);
  const w = P.shape === 'sine' ? sin(TAU * ph) : P.shape === 'triangle' ? 2 * tri(ph + 0.25) - 1
    : 2 * (smoothstep(0, 0.04, f) - smoothstep(0.5, 0.54, f)) - 1;
  const k = smoothstep(P.width, P.width * 0.3, abs(across(p, d) - 0.5 - w * P.height));
  if (k <= 0.002) return null;
  const c = pal('colours', x);
  c[3] = k;
  return c;
}
