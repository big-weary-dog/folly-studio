// Replay: plays the last moments of what is above it again. Every Hold the replay moves on to the newest frames; until
// then Play loops the Length before it, runs back from it, bounces through it, or (hold) freezes its first frame.
// In beats, Length and Hold count the look's tempo. It reads the core's frame buffer (past()), so time going back
// starts it again; cuts come at most every quarter second (hold: every 0.35 s), inside the flash check.
const stage = 'history';
const history = 4;
const params = {
  play: { value: 'loop', type: 'choice', options: ['loop', 'reverse', 'bounce', 'hold'], label: 'Play',
    help: 'loop repeats the Length; reverse runs it backwards; bounce goes back and forth; hold freezes a frame.' },
  length: { value: 1, min: 0.25, max: 2, step: 0.05, label: 'Length (seconds, or beats)',
    showWhen: { play: ['loop', 'reverse', 'bounce'] },
    help: 'How much gets replayed, held to 0.25–2 seconds after beat conversion. Short stutters; long gestures.' },
  hold: { value: 4, min: 0.35, max: 4, step: 0.05, label: 'Hold (seconds, or beats)',
    help: 'Jump interval: Length to 4 seconds minus Length; hold mode: 0.35–4 seconds, after beat conversion.' },
  beats: { value: true, type: 'toggle', label: 'In beats',
    help: 'Counts beats at the look\'s tempo. Limits still apply in seconds; not every value stays on beat.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mix',
    help: 'How much of the replay shows over the live pattern. 1 is all replay; 0.5 ghosts it over the live one.' },
};

let ago = 0;

function frame(t, P, G) {
  const u = P.beats ? 60 / (G.bpm > 0 ? G.bpm : 120) : 1;
  const L = clamp(P.length * u, 0.25, history / 2);
  const H = P.play === 'hold' ? clamp(P.hold * u, 0.35, history) : clamp(P.hold * u, L, history - L);
  const e = t - floor(t / H) * H, x = e % L;      // into this hold, and into the Length
  if (P.play === 'loop') ago = e + L - x;          // [start − L, start), again and again
  else if (P.play === 'reverse') ago = e + x;      // back from the start, again and again
  else if (P.play === 'bounce') ago = e + L - abs(e % (2 * L) - L);
  else ago = e;                                    // the start, held
}

function filter(c, q, t, P) {
  const p = past(ago), m = P.amount;
  for (let i = 0; i < 4; i++) c[i] += (p[i] - c[i]) * m;
  return c;
}
