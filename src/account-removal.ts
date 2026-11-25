// An account deleted, by itself or on People (spec/http "Your account", "People"): the account, its sessions and
// every look it owns (shared ones too), and the looks' frames and previews.
import type { Auth } from './auth.ts';
import type { Logger } from './http.ts';
import type { Store } from './store.ts';

export type Removal = { store: Store, auth: Auth, dropFrames: (id: string) => Promise<unknown>,
  previews?: { drop(id: string): Promise<unknown> }, log?: Logger };

/** Removes account `id` and all it owns; the files go after, a failure logged rather than thrown. */
export async function removeAccount({ store, auth, dropFrames, previews, log = console }: Removal, id: string) {
  const looks = store.looks.list((l) => l.owner === id).map((l) => l.id);
  for (const look of looks) store.looks.remove(look);
  auth.removeUser(id);
  await Promise.all(looks.map((look) => Promise.all([dropFrames(look), previews?.drop(look)]).catch((err) => {
    log.error?.(`account: could not remove the frames or previews of look ${look}:`, err);
  })));
}
