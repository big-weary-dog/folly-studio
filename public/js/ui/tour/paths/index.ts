// The tutorial's paths, the chapters of Rose and arches in the order Tutorials lists them. Getting around opens by
// itself.
import { idea } from './idea.ts';
import { firstLook } from './first-look.ts';
import { keep } from './keep.ts';
import { layers } from './layers.ts';
import { modules } from './modules.ts';
import { moves } from './moves.ts';
import { time } from './time.ts';
import type { Step } from '../types.ts';

export const PATHS = [firstLook, idea, modules, layers, time, moves, keep];

/** A step on Ideas, or one that goes there. */
export const onIdeas = (s: Step) => s.page === '/ideas' || !!s.idea
  || (Array.isArray(s.anchor) && s.anchor.includes('nav:ideas'));
/** The paths this Studio offers: without Ideas (on the Pi, SPEC-offline, or without the AI) no step goes there, and a
 * path that starts there starts on its practice look. */
export const pathsHere = (noIdeas: boolean) => (noIdeas ? PATHS.map((p) => ({ ...p, about: p.aboutPi ?? p.about,
  start: p.look ?? p.start, steps: p.steps.filter((s) => !onIdeas(s)) })) : PATHS);
