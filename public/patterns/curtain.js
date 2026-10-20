// Curtain: a pleated curtain, open by Open (0 shut, 1 open), parting from the middle across Direction; bind Open to
// a hold LFO or the clip envelope to draw it. The cloth runs through Colours from its edge to the sides, its pleats
// shaded; its edge catches the last colour; the opening is clear. Swag opens it wider at the bottom while it opens.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours', blend: 'smooth',
    help: 'Which palette colours the cloth, from its edge to the sides; the last colour lights the drawn edge.' },
  open: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Open',
    help: 'How far the curtain is drawn. 0 is shut across the layer; 1 is fully open and clear.' },
  direction: { value: 'right', type: 'choice', label: 'Direction',
    options: ['up', 'right', 'back'],
    help: 'The way it parts from the middle: right opens it sideways, up top and bottom, back front and back.' },
  pleats: { value: 6, min: 0, max: 30, step: 1, label: 'Pleats across each half',
    help: 'How many folds each half of the cloth has. 0 is flat; high gives fine, close pleats.' },
  swag: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Swag',
    help: 'How much wider it opens at the bottom than the top. 0 is a straight edge; high a deep sweep.' },
  softness: { value: 0.03, min: 0, max: 0.3, step: 0.005, label: 'Edge softness (share of the layer)',
    help: 'How blurred the curtain edge is. 0 is a hard line; high fades the cloth into the opening.' },
};

function pixel(p, t, P) {
  const x = toward(p, P.direction), open = P.open;
  const side = abs(x - 0.5) * 2;                                               // 0 middle … 1 edge
  const edge = open * (1 + P.softness / 2 + P.swag * (1 - p.ly) * (1 - open));   // 1: clear past the soft edge
  const cloth = (side - edge) / max(0.05, 1 - edge);                            // 0 at the drawn edge … 1 at the side
  const fold = wave(cloth * P.pleats * (1 - 0.5 * open) + 0.25);
  const k = soft(edge - (1 - open) * P.softness / 2, side, P.softness);      // shut: no seam down the middle
  if (k <= 0.002) return null;
  const lip = 0.6 * exp(-cloth * cloth * 300) * open;                          // the drawn edge's highlight
  const c = mix(scale(pal('colours', clamp(cloth)), 0.6 + 0.4 * fold), pal('colours', 1), lip);
  c[3] = k;
  return c;
}
