// An idea's states and the moves between them (SPEC "HTTP API" > idea), for the server and the browser alike. Pure:
// no zod, so the browser may import it.

/** The states an idea is stored in, and `interrupted`, which only its log records: a stop cut it short, and the idea
 * is queued again. */
export const IDEA_STATUS = {
  queued: 'queued', generating: 'generating', ready: 'ready', failed: 'failed', interrupted: 'interrupted',
} as const;
export type IdeaStatus = Exclude<keyof typeof IDEA_STATUS, 'interrupted'>;
/** How an idea's run ended, as its log says. */
export type IdeaOutcome = Exclude<keyof typeof IDEA_STATUS, 'queued' | 'generating'>;

/** Still being made: waiting in its lane or running (it counts against its owner's concurrent ideas). */
export const isPending = (i: { status: string }) => i.status === IDEA_STATUS.queued
  || i.status === IDEA_STATUS.generating;

// Where each state may go. Generating again: a restart picks up an idea it cut short; queued again: interrupted, it
// runs once more. Ready and failed are final (a retry is a new idea).
const MOVES: Record<IdeaStatus, readonly IdeaStatus[]> = {
  queued: ['generating', 'failed'],
  generating: ['generating', 'queued', 'ready', 'failed'],
  ready: [],
  failed: [],
};

export class IllegalMove extends Error {}

/** The patch that moves `idea` to `to` (with `patch`'s other fields); throws IllegalMove when that move is not one. */
export function transition<P extends object>(idea: { id?: string, status: string }, to: IdeaStatus, patch?: P) {
  const from = idea.status as IdeaStatus;
  if (!MOVES[from]?.includes(to)) throw new IllegalMove(`idea ${idea.id ?? ''}: ${from} cannot become ${to}`);
  return { ...patch, status: to } as P & { status: IdeaStatus };
}
