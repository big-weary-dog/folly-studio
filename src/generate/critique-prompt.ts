// The critique turn (SPEC-generators "Critique"): what the look rendered to, all of it (each image named with its time,
// the timeline, the frames' analysis, a warning for each top-level group dark or harsh on average beside what the aim
// says of it), the params expand changed, and the ask to compare it with the idea and answer it again.

import type { RigGroup } from '../../shared/schemas/rig.ts';
import { fence } from './prompt.ts';

const DARK = 0.2, HARSH = 0.8, MAX_NOTES = 12;
const pct = (v?: number) => (v == null ? '?' : `${Math.round(v * 100)}%`);

/** The aim's clauses that name a group (its name, id or tags, singular or plural), cut short; '' when none does. */
function aimSays(aim: string, g: Pick<RigGroup, 'id' | 'name' | 'tags'> | undefined, id: string) {
  const words = [...new Set([id, g?.name, ...g?.tags ?? []].filter((w): w is string => !!w)
    .map((w) => w.toLowerCase().replace(/[-_]+/g, ' ').replace(/s$/, '').trim()).filter((w) => w.length > 2))];
  if (!words.length) return '';
  const named = new RegExp(`\\b(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:e?s)?\\b`,
    'i');
  return aim.split(/[.;!?\n]+|,\s+/).map((c) => c.trim()).filter((c) => named.test(c)).slice(0, 2).join('; ')
    .slice(0, 160);
}

/** A line per top-level group whose mean brightness is below 20 % (dark) or above 80 % (harsh), with the aim's words
 * about it. */
export function groupWarnings(means: readonly { id: string, mean: number }[], groups: readonly RigGroup[],
  aim: string) {
  return means.filter((m) => m.mean < DARK || m.mean > HARSH).map((m) => {
    const g = groups.find((x) => x.id === m.id), said = aimSays(aim, g, m.id);
    return `- ${m.id}: ${m.mean < DARK ? 'dark' : 'harsh'}, ${pct(m.mean)} on average; ${said
      ? `the aim says of it: "${fence(said, 'idea', 160)}"` : 'the aim does not name it'}`;
  });
}

/** The repair turn when expand changed many params: what it changed, and the ask to fit them to the library. */
export function buildNotesMessage(notes: readonly string[]) {
  return `The studio changed these params of that look to fit the library:
${notes.slice(0, 20).map((n) => `- ${n}`.slice(0, 200)).join('\n')}

Return the whole look again as JSON with each of these fixed: a number within its range (the catalogue gives each
param's range and default), a param the module has, a value of its kind. Keep everything else as it was.`;
}

/**
 * The critique turn. `stills`: the front view's times (s), then `closeUps` (groups) up close at the same times, in the
 * order the images are sent; `seconds`: how long was rendered; `warnings`: groupWarnings' lines; `notes`: what expand
 * changed in the answer; `revise`: change the part that falls furthest short, rather than returning it unchanged.
 */
export function buildCritiqueMessage({ idea, timeline, analysis, stills, closeUps = [], seconds, warnings = [],
  notes = [], revise }: { idea: unknown, timeline: string, analysis?: { meanBrightness?: number,
  darkFraction?: number, flicker?: { ok?: boolean } }, stills: number[], closeUps?: string[], seconds?: number,
  warnings?: string[], notes?: string[], revise?: boolean }) {
  const a = analysis ?? {};
  const images = [...stills.map((t) => `the front at ${t} s`),
    ...closeUps.flatMap((g) => stills.map((t) => `${g} up close at ${t} s`))].map((d, i) => `${i + 1}. ${d}`);
  const near = closeUps.length ? ' Up close, each LED is drawn as its glass pane: check there that a picture or pattern'
    + ' on it reads as meant.' : '';
  const step = seconds ? Math.max(0.5, seconds / 30) : 1;
  return `The studio rendered that look${seconds ? `, all ${+seconds.toFixed(1)} s of it` : ''}. ${images.length
    ? `The images, in order: ${images.join('; ')} (left to right on the rig is left to right in the image).${near}`
    : ''}
Mean brightness ${pct(a.meanBrightness)} of white, ${pct(a.darkFraction)} of LEDs dark; ${a.flicker?.ok === false
    ? 'large areas FLASH too fast: slow them.' : 'no large-area flashing.'}
${warnings.length ? `Groups to look at (on average over the look):\n${warnings.join('\n')}`
    : 'Every top-level group is between 20% and 80% on average.'}
Each top-level group's mean colour and brightness, every ${+step.toFixed(1)} s:
${timeline}
${notes.length ? `
Your params were changed to fit the library (so the frames show these values, not yours):
${notes.slice(0, MAX_NOTES).map((n) => `- ${n}`.slice(0, 200)).join('\n')}${notes.length > MAX_NOTES
    ? `\n- and ${notes.length - MAX_NOTES} more` : ''}
` : ''}
The idea was:
<idea>
${fence(idea, 'idea', 1000)}
</idea>

Compare what rendered with the idea: the places lit, the colours, the motion, how it changes across its length, the
brightness (a dim or mostly dark look reads as broken; a whole rig at full white is harsh). ${revise ? `Find the part
that falls furthest short of the idea, or would most lift it (a place with no voice of its own, motion that does not
read, a colour off the idea, a tempo that never changes), and change that. Return the whole look again as JSON,
revised.` : `Then return the whole look again as JSON, revised where it falls short; if it already matches, return it
unchanged.`}`;
}
