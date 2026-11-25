// What could not be made, remembered a while so a request does not retry it at once, then tried again: the cause,
// a full disk or a busy machine, may have passed.
export const RETRY_MS = 5 * 60_000;

export function createFailures({ retryMs = RETRY_MS, now = Date.now } = {}) {
  const at = new Map<string, number>(); // key → when it failed
  const fresh = (t: number | undefined) => t !== undefined && now() - t < retryMs;
  return {
    add(key: string) {
      for (const [k, t] of at) if (!fresh(t)) at.delete(k);
      at.set(key, now());
    },
    has(key: string) {
      if (fresh(at.get(key))) return true;
      at.delete(key);
      return false;
    },
  };
}
