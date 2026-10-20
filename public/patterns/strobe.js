// Strobe: flashes the layer at Speed, each flash the next of Colours; 2 a second by default, and over 3 a second on a
// large area fails the flash check. Length is the lit share of each flash; Scatter flashes only some strands;
// Mixed gives each strand its own colour.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'Colours the flashes, stepping to the next colour in the list on each flash.' },
  speed: { value: 2, min: 0.25, max: 8, step: 0.25, label: 'Speed (flashes a second; over 3 fails the flash check)',
    help: 'How often it flashes. Low is a slow blink; high a hard, rapid strobe.' },
  length: { value: 0.15, min: 0.05, max: 0.5, step: 0.01, label: 'Length (share of each flash)',
    help: 'How much of each beat the flash stays lit. Low is a short sharp blip; high stays on for half the beat.' },
  scatter: { value: 0, min: 0, max: 1, step: 0.01, label: 'Scatter',
    help: 'Lights only some strands on each flash, at random. 0 flashes everything; high flashes a scattered few.' },
  fade: { value: 0.15, min: 0, max: 0.25, step: 0.01, label: 'Fade out (share of each flash)',
    help: 'How long each flash fades out at its end. 0 cuts off hard; high tails off softly.' },
  mixed: { value: false, type: 'toggle', label: 'Mixed colours',
    help: 'On gives each strand a random colour from Colours each flash; off flashes them all in one colour.' },
};

function pixel(p, t, P) {
  const x = clock('speed'), n = floor(x), s = min(P.fade, P.length);
  if (P.scatter > 0 && rand(p.fixture, n) < P.scatter * 0.9) return null;
  const on = 1 - soft(P.length - s / 2, x - n, s);          // full on the beat, fading out by the end of Length
  if (on <= 0.002) return null;
  const c = swatch('colours', P.mixed ? rand(p.fixture, n, 3) * 97 : n);
  c[3] = on;
  return c;
}
