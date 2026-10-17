// Snowstorm: highlight flakes with accent tails streak along the wind in lanes, three deep, bent into swirls by
// noise, over the low colour at `sky` (xLights). wind (turns from down), speed, lanes (energy fills more), tail,
// swirl.
const params = {
  wind: { value: 0.12, min: -0.25, max: 0.25, step: 0.01, label: 'Wind (turns from straight down)' },
  speed: { value: 0.6, min: 0.1, max: 2, step: 0.01, label: 'Layer heights a second' },
  lanes: { value: 60, min: 10, max: 120, step: 1 },
  tail: { value: 0.15, min: 0.01, max: 0.4, step: 0.005, label: 'Tail length' },
  swirl: { value: 0.4, min: 0, max: 1, step: 0.01 },
  sky: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Sky brightness' },
};

function pixel(p, t, P, G) {
  const w = TAU * P.wind, s = sin(w), c = cos(w);
  const along = p.lz * s - p.ly * c;                         // downwind
  const across = p.lz * c + p.ly * s + P.swirl * 0.15 * (noise(p.ly * 3, p.lz * 3, t * 0.4) - 0.5);
  const lane = floor(across * P.lanes), deep = floor(p.lx * 2.999);
  let v = 0;
  for (let m = 0; m < 3; m++) {
    if (rand(lane, deep * 3 + m, 4) > 0.25 + 0.7 * G.energy) continue;
    const head = fract(t * P.speed * (0.6 + 0.8 * rand(lane, m, 1)) / 2.6 + rand(lane, m, 2)) * 2.6 - 1.3;
    const behind = head - along;
    if (behind > -0.01) v = max(v, exp(-max(0, behind) / P.tail));
  }
  const col = mix(scale(pal('low', p.ly), P.sky), pal('accent', p.lz), v);
  return mix(col, pal('high'), smoothstep(0.6, 1, v));
}
