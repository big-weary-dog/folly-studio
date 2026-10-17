// Colour wash: the layer fades from palette colour to colour, body and accent in turn (xLights' Color Wash).
// speed (plus energy), hold before each blend, spread (colours across the layer) at angle (0 up, 0.25 across).
const params = {
  speed: { value: 0.2, min: 0, max: 2, step: 0.01, label: 'Colours a second' },
  hold: { value: 0.4, min: 0, max: 0.95, step: 0.01, label: 'Hold before blending' },
  spread: { value: 0.6, min: 0, max: 4, step: 0.05, label: 'Colours across the layer' },
  angle: { value: 0.25, min: 0, max: 1, step: 0.01, label: 'Direction (turns)' },
};

let run = 0, last = 0;
function frame(t, P, G) {
  const dt = t - last, k = P.speed * (0.5 + G.energy);
  run = dt >= 0 && dt < 1 ? run + dt * k : t * k;
  last = t;
}

// The i-th band: body and accent colours in turn, spread along each role.
const swatch = (i) => pal(i & 1 ? 'accent' : 'body', fract(i * 0.618));

function pixel(p, t, P, G) {
  const along = (p.ly - 0.5) * cos(TAU * P.angle) + (p.lz - 0.5) * sin(TAU * P.angle);
  const f = run - along * P.spread, i = floor(f);
  return mix(swatch(i), swatch(i + 1), smoothstep(P.hold, 1, f - i));
}
