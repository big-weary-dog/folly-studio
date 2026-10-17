// Clouds: soft billows drift across the layer, from deep sky to bright cloud.
//
// Fractal noise (fbm) over the layer's width, height and depth makes the billows, drifting with t;
// `cover` sets how much of the sky they hide, and G.energy thickens them a little, so an automated
// energy brings the weather in. Mark it "input only" to use it as a mask for another source.
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
