// A look's edit history (SPEC "HTTP API": PUT /api/looks/:id): changing what plays keeps what was there as a version,
// at most MAX_VERSIONS, and drops the bake and the review. The API's edits and the AI's refinements both go through it.
import { DEFAULT_DURATION } from '../public/js/pattern-core.ts';
import type { StoredLook as Look } from './store.ts';

export const MAX_VERSIONS = 20;

/** The look's versions with what it is now added. */
export function versionsWith(look: Look) {
  const prev = { title: look.title, summary: look.summary ?? '', layers: look.layers ?? [],
    duration: look.duration ?? DEFAULT_DURATION, ...(look.globals ? { globals: look.globals } : {}),
    ...(look.automation ? { automation: look.automation } : {}), savedAt: look.updatedAt };
  return [...(Array.isArray(look.versions) ? look.versions : []), prev].slice(-MAX_VERSIONS);
}

/** What a change to what plays also sets: a version, no bake, no review. */
export const revisedFields = (look: Look): Partial<Look> => ({ versions: versionsWith(look), bake: undefined,
  reviewed: false, reviewedBy: undefined, flashOverride: undefined });
