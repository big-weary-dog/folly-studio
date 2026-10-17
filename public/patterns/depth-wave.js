// Playa wave: colour rolls from the playa front (lx 0) to the back of the nave: a phase growing with lx and
// falling with time travels away from the crowd; tilt leans it with height; tri walks a three-stop palette.
const params = {
  speed: { value: 0.2, min: -1, max: 1, step: 0.01, label: 'Waves per second (− comes toward the playa)' },
  waves: { value: 1.5, min: 0.25, max: 6, step: 0.05, label: 'Waves front to back' },
  tilt: { value: 0.4, min: -2, max: 2, step: 0.05, label: 'Lean with height' },
  c1: { value: '#00e5ff', type: 'color' },
  c2: { value: '#3d00ff', type: 'color' },
  c3: { value: '#ff00b8', type: 'color' },
};

function pixel(p, t, P) {
  const phase = p.lx * P.waves + p.ly * P.tilt - t * P.speed;
  return gradient(tri(phase), [P.c1, P.c2, P.c3]);
}
