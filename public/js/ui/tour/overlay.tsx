// The tutorial's overlay: the welcome, Tutorials (the paths and how far each got), and a step's card beside the
// ring round its control. The page around them dims but stays usable, and the preview stays clear: the card is a
// non-modal dialog, and focus stays where the person is working until they ask Show me.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { cx, humanize } from '../kit.tsx';
import { navigate } from '../session.ts';
import { type Box, byName, follow, moved, pick, visible } from './anchors.ts';
import { close, ctx, here, menu, next, open, PATHS, progress, resumeAt, start, step, titles } from './engine.ts';
import { PAD, place, shade } from './place.ts';
import type { Ctx } from './types.ts';

/** A step's text with the library's names in place of its `{preset:x}`, `{module:x}` and `{param:x.key}`. */
export function fill(text: string, c: Ctx, names: Record<string, string>) {
  return text.replace(/\{(preset|module|param):([a-z0-9-]+)(?:\.([a-zA-Z0-9_]+))?\}/g, (_, kind, name, key) =>
    (kind === 'param' ? c.v?.label(name, key) ?? humanize(key) : names[name] ?? humanize(name)));
}

export function Overlay() {
  const o = open.value;
  if (!o) return null;
  if (o.mode === 'welcome') return <Welcome />;
  if (o.mode === 'menu') return <Menu finished={o.finished} />;
  return <StepCard />;
}

function Panel({ title, children, wide }: { title: string; children: preact.ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('.btn.primary, .tour-path')?.focus(); }, []);
  return <div class="tour-dim"><section ref={ref} class={cx('tour-card tour-panel', wide && 'wide')} role="dialog"
    aria-labelledby="tour-title" aria-label="Tutorial">
    <header class="tour-head"><h2 id="tour-title">{title}</h2>
      <button type="button" class="icon-btn tour-x" aria-label="Close the tutorial" onClick={close}>×</button></header>
    {children}</section></div>;
}

function Welcome() {
  return <Panel title="Welcome to Folly Studio">
    <p>Studio turns show ideas into light on the Folly. The tour shows you the basics.</p>
    <p class="tour-note">Studio is still in development. If something breaks, your name › Report a problem (or F8)
      tells us.</p>
    <div class="tour-actions">
      <button type="button" class="btn ghost" onClick={close}>Not now</button>
      <button type="button" class="btn primary" onClick={() => void start(PATHS[0])}>Start the tour</button></div>
  </Panel>;
}

function Menu({ finished }: { finished?: string }) {
  const p = progress.value;
  return <Panel title={finished ? `${finished}: done` : 'Tutorials'} wide>
    {finished && <p>Pick another, or close this. They are all in your name › Tutorials.</p>}
    <ul class="tour-paths">{PATHS.map((path) => {
      const done = p.done.includes(path.id), part = !done && p.at?.path === path.id;
      const mark = done ? '✓' : part ? '◐' : '○', state = done ? 'done' : part ? 'part-way' : 'not started';
      return <li><button type="button" class="tour-path" data-state={done ? 'done' : part ? 'part' : 'new'}
        onClick={() => void start(path, part ? resumeAt(path) : 0)}>
        <span class="tour-mark" aria-hidden="true">{mark}</span>
        <span class="tour-path-name">{path.title}<span class="sr-only">{`, ${state}`}</span></span>
        <span class="tour-path-about">{path.about}</span></button></li>;
    })}</ul>
  </Panel>;
}

/** How long (ms) a new control is kept in view as what it sits in fills in. */
const SETTLE = 2000;

function StepCard() {
  const o = open.value as Extract<typeof open.value, { mode: 'step' }>, s = step.value!, c = ctx.value;
  const names = typeof s.anchor === 'function' ? s.anchor(c) : s.anchor, on = here.value;
  const el = pick(names), [box, setBox] = useState<Box | null>(null), [lost, setLost] = useState(false);
  const card = useRef<HTMLElement>(null), [h, setH] = useState(180);
  const [slide, setSlide] = useState(false), since = useRef(0);
  useLayoutEffect(() => {   // a new control: scrolled into view (in whatever panel scrolls) before the ring lands
    if (!el) { setBox(null); return undefined; }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    since.current = performance.now();
    setSlide(true);
    const t = setTimeout(() => setSlide(false), 250), unfollow = follow(el, setBox);
    return () => { clearTimeout(t); unfollow(); };
  }, [el]);
  const pvEl = byName('preview'), pv = visible(pvEl) ? pvEl : null, [pvBox, setPvBox] = useState<Box | null>(null);
  useLayoutEffect(() => (pv ? follow(pv, setPvBox) : setPvBox(null)), [pv]);
  useLayoutEffect(() => {   // the page changed: they may have moved, a new control while the page settles back in view
    if (el && performance.now() - since.current < SETTLE) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (el) setBox((b) => moved(el, b));
    if (pv) setPvBox((b) => moved(pv, b));
  }, [c]);
  useLayoutEffect(() => { if (card.current) setH(card.current.offsetHeight); });
  useEffect(() => {   // a control still missing after 4 s: say so, and offer Skip
    setLost(false);
    if (el || !on) return undefined;
    const t = setTimeout(() => setLost(true), 4000);
    return () => clearTimeout(t);
  }, [el, on, o.i]);
  const p = on ? s.progress?.(c) : null, ring = on && box;
  const showMe = () => {
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    el?.focus({ preventScroll: true });
  };
  // Back to the Studio is back to the path's practice look, if it has one.
  const look = o.path.look ?? (o.path.start.startsWith('/studio?') ? o.path.start : null);
  const goTo = () => void navigate(s.page === '/studio' && look ? look : s.page!);
  // Keyed, so a new ring is drawn on its control, never slid in from the corner; from step to step it slides between
  // controls, and otherwise moves with its control as the page scrolls.
  return <>
    <div class={cx('tour-shade', !ring && 'soft')} style={{ clipPath: shade(ring ? box : null, pvBox) }} />
    {ring && <div key="ring" class={cx('tour-ring', o.done && 'done', slide && 'slide')}
      style={{ left: `${box.x - PAD}px`, top: `${box.y - PAD}px`, width: `${box.w + 2 * PAD}px`,
        height: `${box.h + 2 * PAD}px` }} />}
    <section ref={card} class={cx('tour-card tour-step', o.done && 'done')} role="dialog" aria-labelledby="tour-title"
      aria-label="Tutorial" style={place(ring ? box : null, h, pvBox)}>
      <header class="tour-head"><span class="tour-count">{o.path.title}</span>
        <button type="button" class="icon-btn tour-x" aria-label="Close the tutorial" onClick={close}>×</button>
      </header>
      <h2 id="tour-title">{s.title}</h2>
      <p>{fill(s.text, c, titles.value)}</p>
      {!on && <p class="tour-note">{`This step is in the ${s.page === '/studio' ? 'Studio'
        : humanize(s.page!.slice(1))}.`}
        <button type="button" class="btn small" onClick={goTo}>Go there</button></p>}
      {on && lost && <p class="tour-note">Cannot see it? It may be in a folded panel or another tab.</p>}
      {p && <meter class="tour-meter" min={0} max={p.goal} value={Math.min(p.now, p.goal)}
        aria-label={`${p.now.toFixed(2)} of ${p.goal}`} />}
      <p class="tour-status" role="status">{o.done ? 'Done.' : ''}</p>
      <div class="tour-actions">
        {el && <button type="button" class="btn small ghost" onClick={showMe}>Show me</button>}
        {!o.done && <button type="button" class="btn small ghost" onClick={next}>Skip step</button>}
        <button type="button" class="btn small primary" disabled={!o.done} onClick={next}>
          {o.i + 1 === o.path.steps.length ? 'Finish' : 'Next'}</button></div>
      {o.i === 0 && <button type="button" class="tour-link" onClick={() => menu()}>All tutorials</button>}
    </section>
  </>;
}
