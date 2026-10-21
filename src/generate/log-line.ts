// The queue's one line per idea or refinement in the server's log (SPEC-generators "Composition"): its rounds, what
// its look was made of, the docs it read and the first notes.

import type { Uses } from './expand.ts';

export const NO_USES: Uses = { library: 0, extensions: 0, code: 0 };
type Rounds = { draft?: { ms: number, outcome: string }, rounds?: number, check?: number,
  critique?: { ms: number, outcome: string } };

/** The docs a prompted model read, for the log: `; docs 2 (sources/bars, warps/README)`. */
export const describeDocs = (read?: string[]) => (!read ? '' : read.length
  ? `; docs ${read.length} (${read.map((p) => p.replace(/^library\/|\.md$/g, '')).join(', ')})` : '; docs none');
/** What a look was made of, for the log: `3 library, 1 extension`. */
export const describeUses = (u: Uses) => (u === NO_USES ? 'not composed'
  : [`${u.library} library`, u.extensions && `${u.extensions} extension`, u.code && `${u.code} code`]
    .filter(Boolean).join(', '));
/** The first few notes of what was dropped or mended, cut short: the log stays one line. */
export const dropped = (notes: string[]) => (notes.length ? `; ${notes.length} noted: ${notes.slice(0, 3).join('; ')}`
  .slice(0, 240) : '');
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
/** The rounds for the log: `draft 9.0 s (A, B, C), 1 repair, check 0.6 s, critique 12.0 s revised`. */
export const describeRounds = (o: Rounds) => [o.draft && `draft ${secs(o.draft.ms)} (${o.draft.outcome})`,
  o.rounds && `${o.rounds} repair`, o.check !== undefined
  && `check ${secs(o.check)}`, o.critique && `critique ${secs(o.critique.ms)} ${o.critique.outcome}`]
  .filter(Boolean).map((s) => `, ${s}`).join('');
