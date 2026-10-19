// Plasma: a field of four sine waves flowing at Speed, coloured back and forth through Colours.
// Size is a wave's, as a share of the layer.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  speed: { value: 0.6, min: 0, max: 3, step: 0.01, label: 'Speed (waves a second)' },
  size: { value: 0.17, min: 0.05, max: 1, step: 0.01, label: 'Size (share of the layer)' },
};

let s = 0, cx = 0.5, cy = 0.5;

function frame() {
  s = clock('speed');
  cx = 0.5 + 0.35 * sin(s * 0.5);       // the fourth wave's centre wanders
  cy = 0.5 + 0.35 * cos(s * 0.37);
}

function pixel(p, t, P) {
  const k = 1 / P.size;
  const v = sin(p.lz * k * 1.3 + s) + sin(p.ly * k * 1.7 - s * 1.3) + sin((p.lz + p.ly + p.lx) * k * 0.9 + s * 0.7)
    + sin(hypot(p.lz - cx, p.ly - cy) * k * 2.2 - s * 1.1);
  return pal('colours', tri(v / 4 + 0.5));
}
