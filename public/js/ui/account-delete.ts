// What deleting the account says and allows while its looks are counted (SPEC-access "Your account"): nothing is
// deleted until the confirm can say how many looks go, and how many are shared.
export type Count = { all: number, shared: number };
/** The count: loading (null), the looks, or why they could not be counted. */
export type Counting = Count | { error: string } | null;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Whether Delete may be pressed, what the form notes about the count, and the confirm's question. */
export function deleting(count: Counting, username: string) {
  if (!count) return { ready: false, note: 'Counting your looks…' };
  if ('error' in count) return { ready: false, note: `Your looks could not be counted (${count.error}). Reload to try again.` };
  const looks = count.all ? ` and its ${plural(count.all, 'look')}${count.shared
    ? ` (${count.shared} shared in the gallery)` : ''}` : '';
  return { ready: true, note: count.all ? `${plural(count.all, 'look')}${count.shared ? `, ${count.shared} shared` : ''}`
    : 'no looks', question: `Delete the account ${username}${looks}? This cannot be undone.` };
}
