// Heartbeat: Colours swell out in Direction, a heartbeat Every so many beats of the Tempo (the look's bpm, or its
// own), peaking in the last colour. Shape is one thump or a lub-dub; Sharpness how quick each is. Spread is how long a
// beat takes to cross the layer.
const params = {
  colours: { value: 'low body high', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours each beat as it swells, from faint to its peak in the last colour.' },
  direction: { value: 'out', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left', 'back', 'front', 'out', 'in'],
    help: 'Which way each beat travels; out swells from the middle of the LEDs, in closes toward it.' },
  spread: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Spread (seconds)',
    help: 'How long a beat takes to cross the layer. 0 beats everywhere at once; high ripples it across.' },
  tempo: { value: 'look', type: 'choice', label: 'Tempo', options: ['look', 'own'],
    help: "Look beats with the look's bpm; own beats at Own tempo, for a look with no tempo or a heart off the beat." },
  rate: { value: 120, min: 10, max: 240, step: 1, label: 'Own tempo (beats a minute)',
    help: 'The tempo when Tempo is own. Every counts its beats, so 120 with every two is 60 heartbeats a minute.' },
  every: { value: 'two', type: 'choice', label: 'Every (beats)', options: ['half', 'one', 'two', 'four', 'eight'],
    help: 'How often a heartbeat comes, in beats of the tempo: half is twice a beat, eight a slow, rare thump.' },
  shape: { value: 'double', type: 'choice', label: 'Shape', options: ['double', 'single'],
    help: 'Double is a lub-dub, a strong thump and a softer echo just after; single is one thump.' },
  sharpness: { value: 0.5, min: 0, max: 0.95, step: 0.01, label: 'Sharpness',
    help: 'How quick each thump is, as a share of the heartbeat. Low swells slowly; high is a short, hard knock.' },
  second: { value: 0.7, min: 0, max: 1, step: 0.01, label: 'Second beat',
    help: 'How strong the echo of a double is beside the first thump. 0 leaves only the first; 1 matches it.' },
};

const EVERY = { half: 0.5, one: 1, two: 2, four: 4, eight: 8 };

function pixel(p, t, P, G) {
  // out and in: from the LEDs' middle
  const d = P.direction, r = p.sr > 0 ? hypot(p.Y - p.cy, p.Z - p.cz) / p.sr : 0;
  const lag = (d === 'out' ? r : d === 'in' ? 1 - r : toward(p, d)) * P.spread, e = EVERY[P.every];
  // own: heartbeats counted on the rate's clock (beats a minute × seconds), so an LFO on it never jumps
  const ph = P.tempo === 'own' ? fract((clock('rate') - lag * P.rate) / (60 * e)) : beat(t - lag, G.bpm / e);
  const w = 0.3 * (1 - P.sharpness), one = pulse(ph, w);
  const v = P.shape === 'double' ? max(one, P.second * pulse(ph - 0.24, w)) : one;
  if (v < 0.004) return null;
  const c = pal('colours', v);
  c[3] = v;
  return c;
}
