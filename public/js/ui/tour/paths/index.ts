// The tutorial's paths, the chapters of Spire rise in the order Tutorials lists them. First look opens by itself.
import { colour } from './colour.ts';
import { firstLook } from './first-look.ts';
import { keep } from './keep.ts';
import { layers } from './layers.ts';
import { move } from './move.ts';

export const PATHS = [firstLook, colour, layers, move, keep];

/** The paths this Studio offers: on the Pi (SPEC-offline) no step goes to Ideas, which it has not. */
export const pathsHere = (pi: boolean) => (pi ? PATHS.map((p) => ({ ...p, about: p.aboutPi ?? p.about,
  steps: p.steps.filter((s) => s.page !== '/ideas') })) : PATHS);
