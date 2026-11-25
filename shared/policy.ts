// Who may do what (SPEC "HTTP API"), the one place the server and the browser ask. A look someone may not see is
// "not found" to them, never "not yours", so others' unshared looks are not revealed.
export const ROLES = ['member', 'curator', 'admin'] as const;
export type Role = typeof ROLES[number];

export type Action =
  | 'admin'    // the /admin pages and their routes, Deep while it is admins' only
  | 'curate'   // a curator's say (admins have it too)
  | 'see'      // a look: its owner's, or approved (shared, reviewed, not hidden) to anyone; a curator's, any shared
  | 'edit'     // a look: its owner changes it
  | 'delete'   // a look: its owner, or an admin on a shared one
  | 'review'   // a look: a curator marks one they can see reviewed, or hides it
  | 'bake';    // a look: its owner, or a curator on one they can see
type Who = { id: string, role: Role } | null | undefined;
type Owned = { owner: string, shared?: boolean, reviewed?: boolean, hidden?: boolean };

/** Whether a look is in the gallery for everyone (spec/http "Moderation"). */
export const approved = (look: Owned) => look.shared === true && look.reviewed === true && look.hidden !== true;

/** Whether `user` (null: a visitor) may do `action` (on `look`, for the look actions; none is a new look, theirs). */
export function can(user: Who, action: Action, look?: Owned): boolean {
  if (!user) return action === 'see' && !!look && approved(look);   // a visitor (spec/http "Visitors")
  const curator = user.role !== 'member', mine = !look || look.owner === user.id;
  const seen = mine || (curator ? look?.shared === true : approved(look!));
  switch (action) {
    case 'admin': return user.role === 'admin';
    case 'curate': return curator;
    case 'see': return seen;
    case 'edit': return mine;
    case 'delete': return mine || (user.role === 'admin' && seen);
    case 'review': return curator && seen;
    case 'bake': return mine || (curator && seen);
  }
}
