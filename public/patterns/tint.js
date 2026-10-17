// Tint: recolours the chain from the look's palette, keeping its light and shade.
//
// The chain's brightness walks along one palette role (pal(role, t)): dark parts take the start
// of the role, bright parts its end, so the same look follows whichever palette is picked. Roles
// are 0 low, 1 body, 2 accent, 3 high; `amount` blends from the original colour to the tint.
const params = {
  role: { value: 1, min: 0, max: 3, step: 1, label: 'Role: low, body, accent, high' },
  amount: { value: 1, min: 0, max: 1, step: 0.01 },
  spread: { value: 1, min: 0, max: 1, step: 0.01, label: 'How far brightness walks the role' },
};
const ROLES = ['low', 'body', 'accent', 'high'];

function filter(c, q, t, P) {
  const v = max(c[0], c[1], c[2]);
  const tint = pal(ROLES[clamp(round(P.role), 0, 3)], v * P.spread);
  for (let i = 0; i < 3; i++) c[i] = mix(c[i], tint[i] * v, P.amount);
  return c;
}
