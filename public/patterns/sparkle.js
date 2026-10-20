// Sparkle: single LEDs twinkle, each at its own time in a colour from Colours, on transparent. How many is the share
// of LEDs that twinkle; How often is flashes a minute, each LED ±50%. Flash runs from a pinprick (each flash a new
// colour) through longer glints to a slow glow, where every LED drifts up and down in its own colour.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'Colours the flashes, picked at random from the list: a new one each flash; in a slow glow, one an LED.' },
  density: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'How many',
    help: 'The share of LEDs that twinkle. 0 is none, low a few scattered stars, 1 every LED.' },
  often: { value: 36, min: 0, max: 1200, step: 0.1, unit: 'minute', label: 'How often (flashes a minute)',
    help: 'Flashes each LED makes a minute, each at its own pace near it. Tempo (∿) makes it a beat; no jumps.' },
  flash: { value: 0.237, min: 0, max: 1, step: 0.01, label: 'Flash',
    help: 'A quick pinprick at 0, a longer glint at 0.4; from 0.6 a slow glow, every LED drifting up and down.' },
};

// Saved before Flash and How often: mode, length and sharp as Flash; rate (glints a second) as How often.
function upgrade(s) {
  if (s.often === undefined && s.rate !== undefined) s.often = perMinute(s.rate);
  const n = (v, d) => (typeof v === 'number' ? v : d);
  if (s.flash !== undefined) return s;
  if (s.mode === 'smooth') s.flash = 0.6 + 0.4 * (8 - clamp(n(s.sharp, 3), 1, 8)) / 7;
  else if (s.length !== undefined) s.flash = 0.5 * sqrt((clamp(n(s.length, 0.24), 0.02, 1) - 0.02) / 0.98);
  return s;
}
// A rate a second as one a minute: a number, or a binding's values (a Tempo binding counts a beat either way).
function perMinute(v) {
  if (typeof v === 'number') return v * 60;
  if (!v || typeof v !== 'object' || v.mod === 'beats') return v;
  const b = { ...v };
  for (const k of ['center', 'depth', 'from', 'to']) if (typeof b[k] === 'number') b[k] *= 60;
  return b;
}

function pixel(p, t, P) {
  if (rand(p.k, 11) > P.density) return null;
  const x = rand(p.k, 12) * 9.7 + clock('often') / 60 * (0.5 + rand(p.k, 13)), f = P.flash;
  // Flash 0–0.5: a pulse lit for 0.02 to all of each LED's cycle; 0.5–0.6 fades to the glow; 0.6–1 the glow's
  // bright moments from rare (its levels to the 8th power) to even (to the 1st).
  const glow = clamp((f - 0.5) / 0.1);
  let g = glow < 1 ? pulse(x, (0.02 + 0.98 * pow(min(f / 0.5, 1), 2)) / 2) : 0;
  if (glow > 0) {
    const i = floor(x), lv = mix(rand(p.k, i), rand(p.k, i + 1), smoothstep(0, 1, x - i));
    g = mix(g, pow(lv, 8 - 7 * clamp((f - 0.6) / 0.4)), glow);
  }
  if (g <= 0.002) return null;
  const c = swatch('colours', rand(p.k, glow >= 0.5 ? 3 : round(x) + 17) * 97);   // a pulse: each flash its own
  c[3] = g;
  return c;
}
