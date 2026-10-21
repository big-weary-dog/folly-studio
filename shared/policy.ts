// Who may do what (SPEC "HTTP API"), the one place the server and the browser ask. A look someone may not see is
// "not found" to them, never "not yours", so others' unshared looks are not revealed.
import type { Role } from './schemas/models.ts';

export type Action =
  | 'admin'    // the /admin pages and their routes, Deep while it is admins' only
  | 'curate'   // a curator's say (admins have it too)
  | 'see'      // a look: its owner's, or shared
  | 'edit'     // a look: its owner changes or deletes it
  | 'review'   // a look: a curator marks one they can see reviewed
  | 'bake';    // a look: its owner, or a curator on one they can see
type Who = { id: string, role: Role } | null | undefined;
type Owned = { owner: string, shared?: boolean };

/** Whether `user` may do `action` (on `look`, for the look actions; none is a new look, theirs). */
export function can(user: Who, action: Action, look?: Owned): boolean {
  if (!user) return false;
  const curator = user.role !== 'member', mine = !look || look.owner === user.id, seen = mine || look?.shared === true;
  switch (action) {
    case 'admin': return user.role === 'admin';
    case 'curate': return curator;
    case 'see': return seen;
    case 'edit': return mine;
    case 'review': return curator && seen;
    case 'bake': return mine || (curator && seen);
  }
}
