// Splash: wherever what is above it suddenly brightens, ripples spread out through the neighbouring LEDs (links()),
// as if something dropped into water. Each colour channel is its own water (waveStep, as Waves), kicked by how much
// that channel rose since the last frame, so a ripple carries the colour that set it off, crosses others and bounces
// off the ends of each strand. A strobe hit makes the whole map shiver; a chase pushes a wake ahead of it. Show puts
// the ripples on top of what is above, or alone. A stage end: it keeps real LED colours from frame to frame. Time
// going back, or jumping, calms the water.
const stage = 'history';
const params = {
  speed: { value: 20, min: 1, max: 60, step: 1, label: 'Speed (LEDs a second)',
    help: 'How fast ripples travel, in LEDs a second along a strand. Low rolls slowly; high races.' },
  fade: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Fade',
    help: 'How quickly ripples die out. 0 sloshes on; 1 lets each one die within about a second.' },
  strength: { value: 2, min: 0, max: 3, step: 0.05, label: 'Strength',
    help: 'How hard a brightening pushes the water. Low makes faint rings; high makes every hit splash.' },
  show: { value: 'both', type: 'choice', options: ['both', 'ripples'], label: 'Show',
    help: 'both adds the ripples on top of what is above; ripples shows just the water.' },
};

const HZ = 60, BOUNCE = 0.7, GAIN = 5;   // steps a second; how much comes back off a strand's end; light for height
const SLOW = 1 / (0.3 * HZ);           // the water level follows the water over about 0.3 s
let map = null, done = 0, fresh = true, h, v, slow, kick, before;

function reset(L, at) {
  map = L; done = at; fresh = true;
  const three = () => [0, 1, 2].map(() => new Float32Array(L.count));
  h = three(); v = three(); slow = three();
  kick = new Float32Array(3 * L.count); before = new Float32Array(3 * L.count);
}

function frame(t, P) {
  const L = links(), want = floor(t * HZ);
  if (L !== map || want < done || want - done > HZ) reset(L, want);
  else fresh = false;                   // the first frame after a reset only learns what is above
  const { idx } = L, keep = 1 - P.fade * 3 / HZ;
  for (let first = true; done < want; done++, first = false) {
    for (let ch = 0; ch < 3; ch++) {
      const H = h[ch], V = v[ch];
      if (first) for (let j = 0; j < idx.length; j++) V[idx[j]] += kick[3 * idx[j] + ch];
      waveStep(L, H, V, P.speed / HZ, P.fade * 3 / HZ, BOUNCE);
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j];
        H[k] *= keep;                                             // back to calm
        slow[ch][k] += (H[k] - slow[ch][k]) * SLOW;               // the water level, so only what moves shows
      }
    }
    if (first) kick.fill(0);
  }
}

function filter(c, q, t, P) {
  const o = 3 * q.k, a = c[3];
  let top = 0;
  for (let ch = 0; ch < 3; ch++) {
    const now = c[ch] * a, rise = now - before[o + ch];
    if (!fresh && rise > 0) kick[o + ch] += rise * P.strength;
    before[o + ch] = now;
    top = max(top, 1 - exp(-GAIN * abs(h[ch][q.k] - slow[ch][q.k])));
  }
  const alone = P.show === 'ripples', out = alone ? top : max(a, top);
  if (out <= 0) { c[3] = 0; return c; }
  for (let ch = 0; ch < 3; ch++) {
    const light = 1 - exp(-GAIN * abs(h[ch][q.k] - slow[ch][q.k]));
    c[ch] = min(1, ((alone ? 0 : c[ch] * a) + light) / out);
  }
  c[3] = out;
  return c;
}
