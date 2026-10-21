// Who may do what on the engine's socket (SPEC-liveplay "Modes", "People"): the mode, the one person who has the
// knobs, and who has a page open. The engine refuses what the mode does not allow, whatever a page sends.
import type { FromPage, Mode, PiState } from './protocol.ts';

/** Who the Pi's own page is: its PIN is its only gate, and it may drive. */
export const PI_PAGE = 'the Pi\'s page';
export type Who = { name: string, drive: boolean };
const KNOBS = new Set(['set', 'release', 'palette', 'level', 'tap', 'take']);
const DRIVE = new Set([...KNOBS, 'blackout', 'play']);
export const JUKEBOX_NOW = 'The lights are in Jukebox: Play next or Add to the end';

export function createPeople(start: Mode, now: () => number = () => performance.now()) {
  let mode = start, driver: { name: string, at: number } | null = null;
  return {
    get mode() { return mode; },
    /** A new mode; true when it entered Jukebox from Live Play (the caller lets the knobs go). */
    setMode(m: Mode) {
      const back = mode === 'live' && m === 'jukebox';
      mode = m;
      if (back) driver = null;
      return back;
    },
    /** Why `who` (null: Studio's feed) may not send `msg`, or '' when it may; a knob moved takes the knobs. */
    check(who: Who | null, msg: FromPage): string {
      const t = msg.type, feed = who === null;
      if (t === 'mode' || t === 'send') {
        if (!feed) return 'Only Studio sends that.';
        return t === 'send' && msg.at === 'now' && mode === 'jukebox' ? JUKEBOX_NOW : '';
      }
      if (feed) return '';
      const isNow = t === 'play' || (t === 'queue' && msg.at === 'now');
      if (mode === 'jukebox') {
        if (isNow) return JUKEBOX_NOW;
        if (DRIVE.has(t)) return 'The lights are in Jukebox: Live Play has the knobs and Blackout.';
        return '';
      }
      if ((DRIVE.has(t) || isNow) && !who.drive) return 'Watching only: you may not drive Live Play.';
      if (!KNOBS.has(t)) return '';
      if (driver && driver.name !== who.name && t !== 'take') return `${driver.name} has the knobs: Take over first`;
      driver = { name: who.name, at: now() };
      return '';
    },
    /** A page of `name` closed; `open`: another of theirs still is. The knobs are free when the driver's last one
     * closes. */
    left(name: string, open: boolean) {
      if (!open && driver?.name === name) driver = null;
    },
    state(here: string[]): Pick<PiState, 'mode' | 'driver' | 'here'> {
      return { mode, driver: driver && { name: driver.name, ago: (now() - driver.at) / 1000 }, here };
    },
  };
}
export type People = ReturnType<typeof createPeople>;
