// Sparkle: single LEDs glint, each in its own colour from Colours and at its own time, on transparent.
// Density is the share of LEDs that glint; Rate is glints a second. Pulse flashes each glint for Length; Smooth
// glitters every chosen LED up and down instead, Sharp making the bright moments rarer.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'Colours the glints: each LED keeps its own colour, picked at random from the list.' },
  mode: { value: 'pulse', type: 'choice', options: ['pulse', 'smooth'], label: 'Mode',
    help: 'Pulse flashes each glint on and off briefly; smooth lets every chosen LED drift up and down.' },
  density: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Density',
    help: 'How many LEDs take part. 0 is none, low a sparse twinkle, 1 every LED.' },
  rate: { value: 0.6, min: 0.05, max: 20, step: 0.01, label: 'Rate (glints a second)',
    help: 'How often glints come. Low is a slow, sparse twinkle; high a busy shimmer.' },
  length: { value: 0.3, min: 0.02, max: 0.5, step: 0.01, label: 'Length (pulse)',
    help: 'How long each flash lasts in pulse mode. Low is a quick pinprick; high a longer glow.' },
  sharp: { value: 3, min: 1, max: 8, step: 0.5, label: 'Sharp (smooth)',
    help: 'In smooth mode, how rare the bright moments are. 1 glows evenly; high stays mostly dim with brief peaks.' },
};

function pixel(p, t, P) {
  if (rand(p.k, 11) > P.density) return null;
  const x = rand(p.k, 12) * 9.7 + clock('rate') * (0.5 + rand(p.k, 13));
  let g;
  if (P.mode === 'smooth') {
    const i = floor(x);
    g = pow(mix(rand(p.k, i), rand(p.k, i + 1), smoothstep(0, 1, x - i)), P.sharp);
  } else {
    g = pulse(x, P.length);
  }
  if (g <= 0.002) return null;
  const c = swatch('colours', rand(p.k, 3) * 97);
  c[3] = g;
  return c;
}
