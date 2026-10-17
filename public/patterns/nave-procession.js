// Nave procession: body bands with a highlight lead walk from the playa front to the back of the nave (lx),
// a bay each beat at `bpm` (the look's tempo), easing like footsteps; energy swells each bar's downbeat.
// bays, spacing, walk (share of a beat stepping).
const params = {
  bpm: { value: 120, min: 40, max: 240, step: 1, label: 'Beats a minute (the look\'s tempo)' },
  bays: { value: 12, min: 3, max: 40, step: 1, label: 'Steps front to back' },
  spacing: { value: 4, min: 2, max: 12, step: 1, label: 'Bays from band to band' },
  walk: { value: 0.35, min: 0.05, max: 1, step: 0.01, label: 'Share of a beat spent stepping' },
};

function pixel(p, t, P, G) {
  const b = t * P.bpm / 60, n = floor(b), sp = round(P.spacing);
  const x = p.lx * P.bays - n - smoothstep(0, P.walk, b - n);
  const k = ((x % sp) + sp) % sp;                                // 0 … spacing: where in the band this LED is
  const band = smoothstep(0, 0.2, k) * smoothstep(1.3, 1, k);
  const swell = n % 4 === 0 ? (1 - smoothstep(0, 0.6, b - n)) * G.energy * 0.3 : 0;
  const c = mix(pal('low', p.ly), pal('body', p.ly), max(band, swell));
  return mix(c, pal('high'), exp(-(((k - 1.05) / 0.15) ** 2)) * 0.8);
}
