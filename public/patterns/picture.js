// Picture: draws a still or animated picture from text rows and a key (SPEC-library "Pictures"). Grid rose: a row a
// ring from the heart out, read clockwise from the top petal's left edge, Repeat times round; grid square: rows top to
// bottom laid flat over the layer. Key colours follow the look's palette; '.' and space are clear. Frames play at
// Speed, each held for its `hold` ticks.
const params = {
  picture: { type: 'picture', label: 'Picture',
    value: { grid: 'rose', repeat: 4,
      key: { h: 'high', a: 'accent', b: 'body2', c: 'low', d: 'accent3 30%' },
      frames: [{ rows: ['h', 'ab', 'c', 'bbaa', 'dad', 'bc', 'hah'] }] },
    help: 'The picture: text rows and a key of characters to palette colours or #hex, with frames to animate it.' },
  speed: { value: 4, min: 0, max: 30, step: 0.1, label: 'Speed (frames a second)',
    help: 'How fast an animated picture plays, in ticks a second (a frame lasts its hold in ticks). 0 holds frame 1.' },
};

const TOKEN = /^(#[0-9a-f]{6}|(low|body|accent|high)(\d*))(?: (\d+)%)?$/i;
let seen = null, pal = null, frames = [], total = 1, now = null;
const out = [0, 0, 0, 1];

// A key's colour from the look's palette: a role's first colour, a slot (wrapping), or #hex; times its brightness.
function colourOf(token, G) {
  const m = TOKEN.exec(token);
  if (!m) return null;
  let c = m[1][0] === '#' ? hex(m[1]) : null;
  if (!c) {
    const list = G.palette[m[2].toLowerCase()] || G.palette.body, i = m[3] ? Number(m[3]) - 1 : 0;
    c = list.length ? list[i % list.length] : [1, 1, 1];
  }
  return scale(c, m[4] === undefined ? 1 : Number(m[4]) / 100);
}

function load(pic, G) {
  const key = {};
  for (const ch of Object.keys(pic.key)) key[ch] = colourOf(pic.key[ch], G);
  frames = pic.frames.map((f) => ({ hold: f.hold, rows: f.rows.map((row) => [...row].map((ch) => key[ch] || null)) }));
  total = frames.reduce((n, f) => n + f.hold, 0) || 1;
}

function frame(t, P, G) {
  if (P.picture !== seen || G.palette !== pal) {
    seen = P.picture;
    pal = G.palette;
    load(seen, G);
  }
  let k = floor(clock('speed')) % total;
  now = frames[0];
  for (const f of frames) {
    if (k < f.hold) { now = f; break; }
    k -= f.hold;
  }
}

function pixel(p) {
  const rows = now ? now.rows : [];
  let row, col;
  if (seen.grid === 'rose') {
    row = rows[p.ring > 0 ? p.ring - 1 : floor(p.r * 7)];
    if (!row || !row.length) return null;
    col = floor(fract((p.a + 1 / 32) * seen.repeat) * row.length);
  } else {
    row = rows[clamp(floor((1 - p.ly) * rows.length), 0, rows.length - 1)];
    if (!row || !row.length) return null;
    col = clamp(floor(p.lz * row.length), 0, row.length - 1);
  }
  const c = row[col];
  if (!c) return null;
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}
