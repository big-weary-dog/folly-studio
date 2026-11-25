// The tutorial's paths, the chapters of Rose and arches in the order Tutorials lists them. Getting around opens by
// itself.
import { firstLook } from './first-look.ts';
import { guestKeep, keep } from './keep.ts';
import { layers } from './layers.ts';
import { look } from './look.ts';
import { modules } from './modules.ts';
import { moves } from './moves.ts';
import { time } from './time.ts';
export const PATHS = [firstLook, look, modules, layers, time, moves, keep];

/** The paths this Studio offers: a guest's Keep it says an account saves. */
export const pathsHere = (guest = false) => PATHS.map((p) => (guest && p.id === 'keep'
  ? { ...p, steps: p.steps.map((s) => (s.id === 'save' ? guestKeep : s)) } : p));
