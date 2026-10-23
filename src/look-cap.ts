// The most looks one account keeps (SPEC "HTTP API"): POST /api/looks and an idea's new look both keep to it.
import type { Store } from './store.ts';

export const MAX_LOOKS_PER_USER = 500;

/** Throws `fail(why)` when `owner` has MAX_LOOKS_PER_USER looks already. */
export function roomForLook(store: Pick<Store, 'looks'>, owner: string, fail: (why: string) => Error) {
  if (store.looks.list((l) => l.owner === owner).length >= MAX_LOOKS_PER_USER) {
    throw fail(`You have ${MAX_LOOKS_PER_USER} looks; delete some first.`);
  }
}
