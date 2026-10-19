// Curtain: a pleated curtain, open by Open (0 shut, 1 open), parting from the middle across Direction; bind Open to
// a hold LFO or the clip envelope to draw it. The cloth walks Colours across its pleats; its edge catches the last
// colour; the opening is clear. Swag opens it wider at the bottom.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth' },
  open: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Open' },
  direction: { value: 'right', type: 'choice', label: 'Direction',
    options: ['up', 'down', 'right', 'left', 'back', 'front'] },
  pleats: { value: 6, min: 0, max: 30, step: 1, label: 'Pleats across each half' },
  swag: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Swag' },
  softness: { value: 0.03, min: 0, max: 0.3, step: 0.005, label: 'Edge softness (share of the layer)' },
};

function pixel(p, t, P) {
  const d = P.direction, x = toward(p, d), open = P.open;
  const side = d === 'out' || d === 'in' ? x : abs(x - 0.5) * 2;              // 0 middle … 1 edge
  const edge = min(1 + P.softness / 2, open * (1 + P.swag * (1 - p.ly)) * 1.02);
  const cloth = (side - edge) / max(0.05, 1 - edge);                            // 0 at the drawn edge … 1 at the side
  const fold = wave(cloth * P.pleats * (1 - 0.5 * open) + 0.25);
  const k = soft(edge - (1 - open) * P.softness / 2, side, P.softness);      // shut: no seam down the middle
  if (k <= 0.002) return null;
  const c = mix(pal('colours', 0.75 * fold), pal('colours', 1), 0.6 * exp(-cloth * cloth * 300) * open);
  c[3] = k;
  return c;
}
