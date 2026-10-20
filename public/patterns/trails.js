// Trails: a fading afterglow behind whatever moves. A buffer by p.k remembers each LED's light, fading by Decay a
// second (by alpha, so its colour holds and what is below shows through); each LED shows the stronger of what is
// drawn now and its afterglow, so a still soft edge stays soft. Time going back clears it. A stage end: it keeps
// real LED colours from frame to frame, so no warp below it bends what is above.
const stage = 'history';
const params = {
  decay: { value: 0.05, min: 0, max: 0.95, step: 0.01, label: 'Left after one second',
    help: 'How much of the afterglow is left a second later. 0 leaves no trail; high leaves long, lingering smears.' },
};

let mem = new Float32Array(4 * 5000);    // rgb and alpha
let last = NaN, keep = 0;

function frame(t, P) {
  const dt = t - last;
  keep = dt > 0 && dt < 1 ? pow(P.decay, dt) : 0;
  last = t;
}

function filter(c, q, t, P) {
  const o = 4 * q.k, a = c[3];
  if (o + 3 >= mem.length) {             // more LEDs than expected: grow once
    const more = new Float32Array(o + 4000);
    more.set(mem);
    mem = more;
  }
  const left = mem[o + 3] * keep;
  if (a >= left) for (let i = 0; i < 4; i++) mem[o + i] = c[i];       // drawn now wins: remember it
  else {                                                               // the afterglow wins
    for (let i = 0; i < 3; i++) c[i] = mem[o + i];
    mem[o + 3] = c[3] = left;
  }
  return c;
}
