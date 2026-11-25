// People (spec/http "People"): admins list every account, change its role, disable it or delete it.
import type { FastifyRequest } from 'fastify';

import { ROLES } from '../shared/policy.ts';
import { type Account, AccountChange } from '../shared/schemas/api.ts';
import { removeAccount, type Removal } from './account-removal.ts';
import { forAdmins, HttpError, parse } from './http.ts';
import type { StoredUser } from './store.ts';

type Req = FastifyRequest<{ Params: { id: string } }>;

export function peopleRoutes(removal: Removal) {
  const { store, auth } = removal;
  const accountOf = (u: StoredUser): Account => {
    const looks = store.looks.list((l) => l.owner === u.id), set = auth.serverRole(u.username);
    return { id: u.id, username: u.username, role: auth.roleOf(u), ...(set ? { serverRole: set } : {}),
      createdAt: u.createdAt, looks: looks.length, shared: looks.filter((l) => l.shared === true).length,
      disabled: u.disabled === true };
  };
  /** The account `req` names, unless it is the admin's own (409) or none (404). */
  const other = (req: Req) => {
    const u = store.users.get(req.params.id);
    if (!u) throw new HttpError(404, 'No such account.');
    if (u.id === req.user!.id) throw new HttpError(409, 'Not your own account: use Account for that.');
    return u;
  };

  return {
    'GET /admin/accounts': forAdmins(async () => ({ accounts: store.users.list()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(accountOf) })),
    'PUT /admin/accounts/:id': forAdmins(async (req: Req) => {
      const u = other(req), change = parse(AccountChange, req.body), set = auth.serverRole(u.username);
      if (change.role && set && ROLES.indexOf(change.role) < ROLES.indexOf(set)) {
        throw new HttpError(409, `${u.username} is ${set === 'admin' ? 'an admin' : 'a curator'} by the server's `
          + 'settings: change those instead.');
      }
      return { account: accountOf(auth.setAccount(u.id, change)!) };
    }),
    'DELETE /admin/accounts/:id': forAdmins(async (req: Req) => {
      await removeAccount(removal, other(req).id);
      return { ok: true };
    }),
  };
}
