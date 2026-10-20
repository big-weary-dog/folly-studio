// Wave: a line waves across the layer in Direction at Speed, a sine, triangle or square, walking Colours along it.
// Waves is how many fit across; Height is how far it swings.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Colours the line, running through the list along the way the wave travels.' },
  direction: { value: 'right', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left', 'back', 'front'],
    help: 'Which way the wave travels: up, down, across, or front to back.' },
  speed: { value: 0.3, min: -2, max: 2, step: 0.01, label: 'Speed (waves a second)',
    help: 'How fast the wave travels. Low rolls gently; high races; negative runs it backward.' },
  shape: { value: 'sine', type: 'choice', options: ['sine', 'triangle', 'square'], label: 'Shape',
    help: 'Sine is a smooth curve, triangle a zigzag of straight slopes, square a line jumping between two levels.' },
  waves: { value: 1, min: 0.25, max: 8, step: 0.05, label: 'Waves across',
    help: 'How many waves fit across the layer. Low is one long gentle swell; high many tight wiggles.' },
  height: { value: 0.25, min: 0, max: 0.5, step: 0.01, label: 'Height',
    help: 'How far the line swings from the middle. 0 is a straight line; 0.5 swings it edge to edge.' },
  width: { value: 0.1, min: 0.01, max: 0.3, step: 0.005, label: 'Line width (share of the layer)',
    help: 'How thick the line is. Low is a fine thread; high a broad, soft band.' },
};

// The coordinate the line swings in: up for right, left, back and front; across for up and down.
const across = (p, d) => (d === 'up' || d === 'down' ? p.lz : p.ly);

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
