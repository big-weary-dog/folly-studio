// Smoke: light leaves a trail that drifts along each strand in Direction, spreads, wobbles and fades, like smoke off a
// candle (or, down, dripping paint). A buffer by p.k holds the trail (premultiplied rgba); each frame every LED takes
// it from its upwind wire neighbours (k ± 1 on its fixture) as far as Drift carries it, blurs it a little along the
// wire (Spread), fades it, and shows what is drawn now over it. Curl varies the drift in space and time, so it
// billows. Time going back or jumping clears it. A stage end: it keeps real LED colours from frame to frame.
const stage = 'history';
const params = {
  direction: { value: 'up', type: 'choice', options: ['up', 'down', 'right', 'left', 'out', 'in'],
    label: 'Direction', help: 'Which way the trail drifts up like smoke, down like dripping paint.' },
  drift: { value: 0.8, min: 0, max: 3, step: 0.01, label: 'Drift (metres a second)',
    help: 'How fast the trail travels. 0 leaves it in place; 0.3 drips; 1–2 rises like smoke.' },
  spread: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Spread',
    help: 'How much it widens along the strand as it goes. 0 keeps it sharp; 1 blooms into soft plumes.' },
  fade: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Fade',
    help: 'How quickly the trail disappears. 0 lingers for many seconds; 1 is gone in a moment.' },
  curl: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Curl',
    help: 'How much it wobbles as it goes. 0 is a steady stream; 1 puffs and stalls in billows.' },
};

let now = new Float32Array(4 * 5000), was = new Float32Array(4 * 5000);   // trail this frame and last
let at = new Float32Array(4 * 5000);       // each LED's X Y Z, and its fixture + 1 (0 not seen yet)
let last = NaN, dt = 0, keep = 0, clear = true;

function frame(t, P) {
  const d = t - last;
  clear = !(d >= 0 && d < 0.5);
  dt = clear ? 0 : d;
  keep = exp(-dt * (0.2 + 12 * P.fade * P.fade));
  last = t;
  const s = was;
  was = now;
  now = s;
}

// Where LED k sits along the drift (metres), seen from a layer centred at (cy, cz) in the façade.
function along(o, dir, cy, cz) {
  if (dir === 'up') return at[o + 1];
  if (dir === 'down') return -at[o + 1];
  if (dir === 'right') return at[o + 2];
  if (dir === 'left') return -at[o + 2];
  const r = hypot(at[o + 2] - cz, at[o + 1] - cy);
  return dir === 'out' ? r : -r;
}

function bigger(old, n) {
  const more = new Float32Array(n + 4000);
  more.set(old);
  return more;
}

function filter(c, q, t, P) {
  const o = 4 * q.k;
  if (o + 7 >= now.length) { now = bigger(now, o); was = bigger(was, o); at = bigger(at, o); }
  at[o] = q.X; at[o + 1] = q.Y; at[o + 2] = q.Z; at[o + 3] = q.fixture + 1;
  let r = 0, g = 0, b = 0, a = 0;
  if (!clear) {
    const me = along(o, P.direction, q.cy, q.cz);
    const wob = 1 + P.curl * 2.5 * (noise(me * 1.5, t * 0.8, q.fixture * 7.3) * 2 - 1);
    const sp = min(0.45, P.spread * P.spread * dt * 20);
    r = was[o]; g = was[o + 1]; b = was[o + 2]; a = was[o + 3];
    let dr = 0, dg = 0, db = 0, da = 0, pull = 0;
    for (let s = -4; s <= 4; s += 8) {     // the wire neighbours k − 1 and k + 1
      const n = o + s;
      if (n < 0 || at[n + 3] !== at[o + 3]) continue;
      const step = hypot(at[n] - at[o], at[n + 1] - at[o + 1], at[n + 2] - at[o + 2]) || 1;
      const up = me - along(n, P.direction, q.cy, q.cz);
      // upwind: as far along the wire as the drift's share along it carries in dt, in steps
      const f = up > 0 ? max(0, P.drift * dt * wob * up / (step * step)) : 0;
      const w = min(1, f) + sp;
      dr += (was[n] - r) * w; dg += (was[n + 1] - g) * w; db += (was[n + 2] - b) * w; da += (was[n + 3] - a) * w;
      pull += w;
    }
    const w = pull > 1 ? 1 / pull : 1;
    r = (r + dr * w) * keep; g = (g + dg * w) * keep; b = (b + db * w) * keep; a = (a + da * w) * keep;
  }
  const ca = c[3], rest = 1 - ca;          // what is drawn now, over the trail
  r = c[0] * ca + r * rest; g = c[1] * ca + g * rest; b = c[2] * ca + b * rest; a = ca + a * rest;
  now[o] = r; now[o + 1] = g; now[o + 2] = b; now[o + 3] = a;
  if (a > 1e-4) { c[0] = r / a; c[1] = g / a; c[2] = b / a; }
  c[3] = a;
  return c;
}
