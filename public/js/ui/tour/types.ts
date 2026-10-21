// What a tutorial path is (SPEC-tutorial): plain data, steps that wait on what the Studio shows.
import { tourName, type TourView } from '../tour-view.ts';

/** What a step reads: the Studio (null on other pages), the page's path, and the controls the tour points at. */
export type Ctx = { v: TourView | null; page: string; el: (name: string) => Element | null };

export type Step = {
  id: string;
  title: string;
  /** One instruction. `{preset:x}`, `{module:x}` and `{param:x.key}` are the library's names for its entry `x` and
   * its param `key`, so a rename in the library changes the text. */
  text: string;
  /** The page it happens on (a path prefix); the card offers to go there. */
  page?: string;
  /** Where to point, by `data-tour` name, outermost first: the ring goes to the last one on screen. */
  anchor: string[] | ((c: Ctx) => string[]);
  /** What `done` compares against, read when the step starts. */
  begin?: (c: Ctx) => unknown;
  done: (c: Ctx, base: unknown) => boolean;
  /** The value against its goal, shown as a meter. */
  progress?: (c: Ctx) => { now: number; goal: number } | null;
  /** Wait for Next even once done (a step to read, the last one). */
  next?: boolean;
};

export type Path = {
  id: string; title: string; about: string; minutes: number;
  /** Where it starts: the blank Studio, or its practice look (`/studio?tour=<id>`). */
  start: string; steps: Step[];
};

/** A number a param holds, or null (bound to a modulator, or unset). */
export const num = (x: unknown) => (typeof x === 'number' ? x : null);
/** The look's layer whose `data-tour` name is `slug` (its title, tourName'd). */
export const layerBy = ({ v }: Ctx, slug: string) => v?.layers.value.find((l) => tourName(l.title) === slug) ?? null;
/** A param bound to a modulator, and which kind ('beats' is a beat clock's). */
export const boundTo = (x: unknown) => (x && typeof x === 'object' && 'mod' in x ? String(x.mod) : null);
