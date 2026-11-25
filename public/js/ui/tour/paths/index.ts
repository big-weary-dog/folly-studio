// The tutorial's path (spec/studio "Tutorial"): Getting around, which opens by itself.
import { firstLook, guestKeep } from './first-look.ts';
export const PATHS = [firstLook];

/** The paths this Studio offers: a guest's Save says an account saves. */
export const pathsHere = (guest = false) => PATHS.map((p) => (guest
  ? { ...p, steps: p.steps.map((s) => (s.id === 'save' ? guestKeep : s)) } : p));
