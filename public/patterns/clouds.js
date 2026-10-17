// Clouds: soft billows of fbm noise drift across the layer, from deep sky to bright cloud; `cover` sets how
// much sky they hide and G.energy thickens them. Mark it "input only" to mask another source with it.
const params = {
  scale: { value: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Billow size (smaller is bigger)' },
  drift: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'Drift speed' },
  cover: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Cloud cover' },
  sky: { value: '#0b1a4a', type: 'color' },
  cloud: { value: '#e8ecff', type: 'color' },
};

function pixel(p, t, P, G) {
  const s = t * P.drift;
  const n = fbm(p.lz * P.scale + s, p.ly * P.scale * 0.6 - s * 0.2, p.lx * P.scale * 0.5 + s * 0.3);
  const edge = 1 - clamp(P.cover + (G.energy - 0.5) * 0.3);
  const v = smoothstep(edge - 0.15, edge + 0.15, n);
  return mix(P.sky, P.cloud, v);
}
