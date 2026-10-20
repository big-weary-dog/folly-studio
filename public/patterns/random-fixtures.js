// Random fixtures: each fixture switches on or off at random, Speed times a second, in a colour picked at random
// from Colours. Density is the share lit; Scatter spreads the switches through each step (0: all at once, a glitch);
// Fade softens each switch.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours',
    help: 'Which palette colours a fixture may take each time it lights; one colour lights them all alike.' },
  speed: { value: 2, min: 0.1, max: 12, step: 0.05, label: 'Speed (switches a second)',
    help: 'How often the fixtures switch. Low changes slowly; high is a fast glitch (the bake checks for flashing).' },
  density: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'Density (share lit)',
    help: 'The share of fixtures lit at once. Low leaves a few lit; high lights most of them.' },
  scatter: { value: 0, min: 0, max: 1, step: 0.01, label: 'Scatter (share of a step)',
    help: 'How far apart the fixtures switch within a step. 0 switches them all together; 1 spreads them evenly.' },
  fade: { value: 0, min: 0, max: 1, step: 0.01, label: 'Fade (share of a step)',
    help: 'How long each switch takes. 0 snaps on and off; high eases between one step and the next.' },
};

function pixel(p, t, P) {
  const f = p.fixture, x = clock('speed') - rand(f, 7) * P.scatter, n = floor(x), on = rand(f, n) < P.density;
  const was = rand(f, n - 1) < P.density, k = P.fade > 0 ? smoothstep(0, P.fade, x - n) : 1;
  const v = on ? (was ? 1 : k) : was ? 1 - k : 0;
  if (v <= 0.002) return null;
  const c = pal('colours', rand(f, on ? n : n - 1, 3));
  c[3] = v;
  return c;
}
