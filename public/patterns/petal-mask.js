// Petal mask: shows picked rose petals and cells; Show the rest reverses it. Hidden is transparent.
// Off the rose, petals divide the angle into sixteenths and rings divide the radius into sevenths.
const params = {
  petals: { value: '1-4 9-12', type: 'text', petals: true, label: 'Petals shown',
    help: 'The petals that show, 1 the top one, on clockwise: numbers and runs (3 5 9-12; 15-2 wraps). Click them.' },
  cells: { value: '1-14', type: 'text', cells: true, label: 'Cells shown',
    help: 'The cells that show in every petal shown, 1 at the heart, ring by ring out: numbers and runs. Click them.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mask strength',
    help: 'How fully the rest is hidden. Zero hides nothing; one makes it fully transparent.' },
  softness: { value: 0.05, min: 0.01, max: 1, step: 0.01, label: 'Edge softness',
    help: 'Petal edges only: low cuts at lead lines, high fades wide. Small changes may land on the same LEDs.' },
  invert: { value: false, type: 'toggle', label: 'Show the rest',
    help: 'Off shows the petals and cells named; on hides them and shows the rest.' },
};

// A ring's cells, 1 to 3 across: CELL[ring * 3 + side] is the cell (0–13) on that side of the petal's centre line
// (0 counterclockwise of it, 1 on it, 2 clockwise), for rings 1–7. Rings 2, 4 and 6 hold two, split at the line.
const CELL = [0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8, 9, 9, 10, 11, 12, 13];
const petal = new Float32Array(16), cell = new Float32Array(14), was = ['', ''];
let cy = 0, cz = 0;

// Which of n show, 1 or 0, into `on`: numbers 1–n and runs a-b, wrapping past n.
function readSet(text, n, on) {
  on.fill(0);
  for (const w of String(text).split(/[\s,]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(w), a = m ? +m[1] : 0, b = m && m[2] ? +m[2] : a;
    if (a < 1 || a > n || b < 1 || b > n) continue;
    for (let i = a - 1; ; i = (i + 1) % n) {
      on[i] = 1;
      if (i === b - 1) break;
    }
  }
}

function frame(t, P) {
  const c = centres('rose')[0];
  if (c) { cy = c[1]; cz = c[2]; }
  if (P.petals !== was[0]) readSet(was[0] = P.petals, 16, petal);
  if (P.cells !== was[1]) readSet(was[1] = P.cells, 14, cell);
}

// How much of q shows: its petal's, softened toward the next petal's over Softness of the petal, times its cell's.
// On the rose, its sector, ring and angle round the rose's centre; off it, its angle and radius round the layer's.
function filter(c, q, t, P) {
  const rose = q.sector >= 0, a = rose ? fract(atan2(q.Z - cz, q.Y - cy) / TAU) : q.a;
  const s = rose ? q.sector % 16 : floor(fract(a + 1 / 32) * 16), u = fract(a * 16 + 0.5), e = 2 * abs(u - 0.5);
  const ring = rose && q.ring > 0 ? min(7, q.ring) : min(7, floor(q.r * 7) + 1);
  let m = petal[s];
  if (e > 1 - P.softness) m = mix(m, petal[(s + (u < 0.5 ? 15 : 1)) % 16], 0.5 * (e - 1 + P.softness) / P.softness);
  m *= cell[CELL[ring * 3 + (ring % 2 === 0 ? (u < 0.5 ? 0 : 2) : u < 1 / 3 ? 0 : u > 2 / 3 ? 2 : 1)]];
  if (P.invert) m = 1 - m;
  c[3] *= 1 - P.amount * (1 - m);        // c is the chain's colour: change it and hand it back
  return c;
}
