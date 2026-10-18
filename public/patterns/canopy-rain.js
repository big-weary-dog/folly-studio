// Canopy rain: highlight drops with accent tails streak down the layer in columns across width and depth
// (energy turns a shower into a downpour), beading on the canopy runs, where they linger, over the low colour at
// `sky`. columns, speed, tail. The canopy is whatever the rig tags `canopy`.
const params = {
  columns: { value: 30, min: 8, max: 80, step: 1, label: 'Columns across' },
  speed: { value: 0.9, min: 0.2, max: 3, step: 0.05, label: 'Layer heights a second' },
  tail: { value: 0.12, min: 0.02, max: 0.4, step: 0.01, label: 'Tail length' },
  sky: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Sky brightness' },
};

function pixel(p, t, P, G) {
  const col = floor(p.lz * P.columns) * 7 + floor(p.lx * 6.999), long = p.is('canopy') ? 4 : 1;
  let v = 0;
  for (let m = 0; m < 2; m++) {
    if (rand(col, m, 5) > 0.3 + 0.7 * G.energy) continue;
    const head = 1.1 - fract(t * P.speed * (0.8 + 0.4 * rand(col, m, 1)) / 1.4 + rand(col, m, 2)) * 1.4;
    const above = p.ly - head;                                   // ≥ 0 above the head, where its tail is
    if (above > -0.01) v = max(v, exp(-max(0, above) / (P.tail * long)));
  }
  const c = mix(scale(pal('low', p.ly), P.sky), pal('accent', p.ly), min(1, v * 1.2));
  return mix(c, pal('high'), smoothstep(0.8, 1, v));
}
