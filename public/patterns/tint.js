// Tint: recolours the chain from one role of the look's palette, keeping its light and shade: brightness walks
// along the role (pal(role, t)), so the look follows whichever palette is picked. amount blends.
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
