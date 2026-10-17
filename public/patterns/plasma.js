// Plasma: the demoscene classic: four sines (across, up, through depth, and round a centre frame() moves) sum
// to a value that indexes a palette: 0 a full rainbow, 1-3 Inigo Quilez cosine palettes.
const params = {
  speed: { value: 0.6, min: 0, max: 3, step: 0.01 },
  scale: { value: 6, min: 1, max: 20, step: 0.1, label: 'Detail' },
  palette: { value: 0, min: 0, max: 3, step: 1 },
  drift: { value: 0.05, min: 0, max: 0.5, step: 0.01, label: 'Palette drift' },
};

let cx = 0, cy = 0, tt = 0;

function frame(t, P) {
  tt = t * P.speed;
  cx = 0.5 + 0.35 * sin(tt * 0.5);
  cy = 0.5 + 0.35 * cos(tt * 0.37);
}

function pixel(p, t, P) {
  const s = P.scale;
  let v = sin(p.lz * s * 1.3 + tt)
        + sin(p.ly * s * 1.7 - tt * 1.3)
        + sin((p.lz + p.ly + p.lx) * s * 0.9 + tt * 0.7)
        + sin(hypot(p.lz - cx, p.ly - cy) * s * 2.2 - tt * 1.1);
  v = v / 8 + 0.5 + t * P.drift;
  switch (round(P.palette)) {
    case 1: return cosPalette(v, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 0.5], [0.8, 0.9, 0.3]);
    case 2: return cosPalette(v, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 0.7, 0.4], [0, 0.15, 0.2]);
    case 3: return cosPalette(v, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [2, 1, 0], [0.5, 0.2, 0.25]);
    default: return hsv(v, 1, 1);
  }
}
