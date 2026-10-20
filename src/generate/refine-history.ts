// A look's refine history (SPEC-generators "Refine history"): the idea that made it, then its earlier ready
// refinements that were not undone, each a line of request, changes and critique verdict, for the next refinement's
// turn. Records only: requests and change lines, never answers.
import type { Idea } from '../../shared/schemas/api.ts';

export const HISTORY_ENTRIES = 8;
export const HISTORY_CHARS = 1500;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const flat = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** One refinement as a line: `"slower" → Fire: speed 0.4 → 0.2; + layer Sparkle (sparkle) [critique: revised]`. */
export function historyLine(i: Pick<Idea, 'text' | 'refine' | 'changes' | 'verdict'>) {
  const asked = flat(i.text) ? `"${clip(flat(i.text), 200)}"`
    : i.refine?.fix ? `a fix of layer "${clip(flat(i.refine.fix.layer), 40)}"` : 'a critique';
  const changes = i.changes?.length ? clip(i.changes.map(flat).join('; '), 240) : 'nothing changed';
  return `${asked} → ${changes}${i.verdict ? ` [critique: ${clip(flat(i.verdict), 60)}]` : ''}`;
}

/** The history of a look before `idea` (a refinement of it), oldest first, at most HISTORY_ENTRIES lines in
 * HISTORY_CHARS; '' when there is nothing to say. `made`: the text of the idea that made the look. */
export function refineHistory(ideas: Idea[], idea: Idea, made?: string) {
  const first = flat(made) ? `The idea: "${clip(flat(made), 300)}"` : '';
  const earlier = ideas.filter((i) => i.id !== idea.id && i.lookId === idea.lookId && i.refine && !i.undone
    && i.status === 'ready' && i.createdAt <= idea.createdAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lines: string[] = [];
  let room = HISTORY_CHARS - first.length;
  for (const i of earlier.reverse()) {
    const line = `Then ${historyLine(i)}`;
    if (lines.length >= HISTORY_ENTRIES - (first ? 1 : 0) || line.length + 1 > room) break;
    lines.unshift(line);
    room -= line.length + 1;
  }
  return [first, ...lines].filter(Boolean).join('\n');
}
