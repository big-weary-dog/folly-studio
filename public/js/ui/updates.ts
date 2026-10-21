// A new build under an open page (SPEC "Updates"): /build.json names the commit the server serves; a page that sees it
// change, or a lazy chunk fail to load, reloads by itself when nothing is unsaved, once per build (a sessionStorage
// marker, so a build whose chunks really fail cannot loop), and otherwise leaves it to the caller's toast.
import { leaveGuard } from './session.ts';

const MARK = 'folly-reloaded-for', EVERY = 5 * 60_000;
/** Text controls whose text, once left, is the store's (the code editor, a param's lines): the dirty flag covers
 *  them. Focused, any text control counts: a param's lines reach the store only on leaving it. */
const KEPT = '[data-kept]';

/** The commit /build.json names, or null (none: a dev server, or the network is down). */
async function served(): Promise<string | null> {
  try {
    const r = await fetch(`/build.json?t=${Date.now()}`, { cache: 'no-store' });
    const j: unknown = r.ok ? await r.json() : null;
    const commit = j && typeof j === 'object' ? (j as { commit?: unknown }).commit : null;
    return typeof commit === 'string' && commit ? commit : null;
  } catch { return null; }
}

/** Anything a reload would lose: the Studio's unsaved edits, a field being typed in, or text in a form. */
export function unsaved(doc: Document = document) {
  if (leaveGuard.isDirty?.()) return true;
  const a = doc.activeElement;
  if (a?.matches('textarea, [contenteditable], input:not([type=checkbox], [type=radio], [type=button], [type=range])'))
    return true;
  return [...doc.querySelectorAll<HTMLTextAreaElement>(`textarea:not(${KEPT})`)].some((t) => t.value.trim() !== '');
}

/** Reloads the page onto the new build unless something is unsaved or it already reloaded for this build. */
export async function reloadIfIdle(): Promise<boolean> {
  if (unsaved()) return false;
  const build = await served() ?? 'unknown';
  try {
    if (sessionStorage.getItem(MARK) === build) return false;
    sessionStorage.setItem(MARK, build);
  } catch { return false; }   // no storage, no loop guard: leave it to the person
  if (unsaved()) return false;   // typed into while /build.json answered
  location.reload();
  return true;
}

/** Checks /build.json at start, on coming back to the tab and every few minutes; `stale` runs when it changed. */
export function watchBuild(stale: () => void) {
  let booted: string | null = null;
  const check = async () => {
    const now = await served();
    if (!booted) booted = now;
    else if (now && now !== booted) stale();
  };
  void check();
  setInterval(check, EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
}
