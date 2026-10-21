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
  /** While open, the Ideas page opens this practice look (`/studio?tour=<id>`) instead of asking a model. */
  idea?: string;
};

export type Path = {
  id: string; title: string; about: string;
  /** What it covers on the Pi, where its Ideas steps are left out (SPEC-offline), when that differs. */
  aboutPi?: string;
  /** Where it starts: the blank Studio, its practice look (`/studio?tour=<id>`), or another page. */
  start: string; steps: Step[];
  /** Its practice look when it starts on another page: where its Studio steps go back to. */
  look?: string;
};

/** A number a param holds, or null (bound to a modulator, or unset). */
export const num = (x: unknown) => (typeof x === 'number' ? x : null);
/** The look's layer whose `data-tour` name is `slug` (its title, tourName'd). */
export const layerBy = ({ v }: Ctx, slug: string) => v?.layers.value.find((l) => tourName(l.title) === slug) ?? null;
/** A param bound to a modulator, and which kind ('beats' is a beat clock's). */
export const boundTo = (x: unknown) => (x && typeof x === 'object' && 'mod' in x ? String(x.mod) : null);
/** The selected layer is `slug` and its open module is library `ref`. */
export const at = (c: Ctx, slug: string, ref: string) => !!c.v && c.v.selected.value?.id === layerBy(c, slug)?.id
  && c.v.module.value?.ref === ref;
/** The open module's param `key`, when that module is `ref` on layer `slug`. */
export const param = (c: Ctx, slug: string, ref: string, key: string) => (at(c, slug, ref)
  ? c.v!.params.value[key] : undefined);
/** An anchor on layer `slug`'s settings (in its module `ref`, when given): that layer first, then that module, then
 * `names`. With no Studio, all of them. */
export const on = (slug: string, ref: string | null, ...names: string[]) => (c: Ctx) => {
  const layer = [`layer:${slug}`], mod = ref ? [`module:${ref}`] : [];
  if (!c.v) return [...layer, ...mod, ...names];
  if (c.v.selected.value?.id !== layerBy(c, slug)?.id) return layer;
  return ref && c.v.module.value?.ref !== ref ? mod : names;
};
/** A pick's tokens (a colour param's value). */
export const tokens = (x: unknown) => (typeof x === 'string' ? x.split(/\s+/) : []);
/** A step done once `first` has held and then `then` holds: a switch off and on again, pause then play. */
export const twice = (first: (c: Ctx) => boolean, then: (c: Ctx) => boolean): Pick<Step, 'begin' | 'done'> => ({
  begin: () => ({ seen: false }),
  done: (c, b) => {
    const was = b as { seen: boolean };
    if (!was.seen && first(c)) was.seen = true;
    return was.seen && then(c);
  },
});
