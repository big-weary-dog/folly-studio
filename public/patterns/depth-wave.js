// Playa wave: colour rolls from the playa front to the back of the nave.
//
// lx is depth across the layer (0 = the playa side, 1 = the back), so a phase that grows with
// lx and falls with time is a wavefront travelling away from the crowd. Tilt leans the front
// so it climbs as it goes. The colour walks a three-stop palette back and forth (tri), so
// every LED is always at full colour.
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
