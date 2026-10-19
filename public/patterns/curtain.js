// Curtain: a pleated curtain of body colours draws open from the middle, holds, closes, over the low colour,
// its edge catching the highlight (more with energy). cycle (seconds), pleats, swag (wider at the bottom), softness.
const params = {
  cycle: { value: 8, min: 2, max: 30, step: 0.5, label: 'Seconds per open and close' },
  pleats: { value: 6, min: 0, max: 30, step: 1, label: 'Pleats across each half' },
  swag: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Open wider at the bottom' },
  softness: { value: 0.03, min: 0, max: 0.3, step: 0.005, label: 'Edge softness (share of each half)' },
};

function pixel(p, t, P, G) {
  const ph = fract(t / P.cycle);
  const open = smoothstep(0.05, 0.4, ph) - smoothstep(0.55, 0.9, ph);       // 0 shut … 1 open
  const side = abs(p.lz - 0.5) * 2;                                           // 0 middle … 1 edge
  const edge = min(1, open * (1 + P.swag * (1 - p.ly)) * 1.02);
  const cloth = (side - edge) / max(0.05, 1 - edge);                          // 0 at the drawn edge … 1 at the side
  const fold = wave(cloth * P.pleats * (1 - 0.5 * open) + 0.25);
  const k = soft(edge, side, P.softness);
  const c = mix(pal('low', p.ly), pal('body', 0.2 + 0.45 * fold), k);
  return mix(c, pal('high'), exp(-cloth * cloth * 300) * k * open * (0.3 + 0.6 * G.energy));
}
