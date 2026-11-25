// What one account's looks may hold (SPEC "HTTP API"): POST /api/looks and an idea's new look keep to the count and
// the bytes; a change to a look keeps to the bytes when it grows them.
import type { Store, StoredLook } from './store.ts';

export const MAX_LOOKS_PER_USER = 500;
/** An account's looks with their versions, as stored. */
export const MAX_LOOK_BYTES_PER_USER = 20 * 2 ** 20;

const sizeOf = (look: Partial<StoredLook>) => Buffer.byteLength(JSON.stringify(look));
/** What the store adds to a new look: its id (16 characters) and two timestamps. */
const stored = (look: Partial<StoredLook>, at = new Date().toISOString()) => ({ id: 'x'.repeat(16), ...look,
  createdAt: at, updatedAt: at });
const full = (fail: (why: string) => Error) => fail(
  `Your looks hold ${MAX_LOOK_BYTES_PER_USER / 2 ** 20} MB, the most an account keeps; delete some first.`);

/** `look`; throws `fail(why)` when `owner` has MAX_LOOKS_PER_USER looks already, or `look` would take its looks past
 * the bytes. */
export function roomForLook<T extends Partial<StoredLook>>(store: Pick<Store, 'looks'>, owner: string,
  fail: (why: string) => Error, look: T = {} as T) {
  if (store.looks.count((l) => l.owner === owner) >= MAX_LOOKS_PER_USER) {
    throw fail(`You have ${MAX_LOOKS_PER_USER} looks; delete some first.`);
  }
  if (store.looks.bytes((l) => l.owner === owner) + sizeOf(stored(look)) > MAX_LOOK_BYTES_PER_USER) throw full(fail);
  return look;
}

/** `patch`; throws `fail(why)` when it grows `was` and its owner's looks past the bytes. */
export function roomToGrow<T extends Partial<StoredLook>>(store: Pick<Store, 'looks'>, was: StoredLook, patch: T,
  fail: (why: string) => Error) {
  const grows = sizeOf({ ...was, ...patch }) - sizeOf(was);
  if (grows > 0 && store.looks.bytes((l) => l.owner === was.owner) + grows > MAX_LOOK_BYTES_PER_USER) {
    throw full(fail);
  }
  return patch;
}
