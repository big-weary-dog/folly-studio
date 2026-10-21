// The tutorial's overlay: the welcome, Tutorials (the paths and how far each got), and a step's card beside the
// ring round its control. Everything else dims but stays usable: the card is a non-modal dialog, and focus stays
// where the person is working until they ask Show me.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { cx, humanize } from '../kit.tsx';
import { navigate } from '../session.ts';
import { type Box, follow, pick } from './anchors.ts';
import { close, ctx, here, menu, next, open, PATHS, progress, resumeAt, start, step, titles } from './engine.ts';
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
    <p>Studio turns show ideas into light on the Folly. A two-minute tour shows you round with a look of your own:
      a preset, the 3D view, a module and its settings.</p>
    <p class="tour-note">Studio is still in development. If something breaks, your name › Report a problem (or F8)
      tells us.</p>
    <div class="tour-actions">
      <button type="button" class="btn ghost" onClick={close}>Not now</button>
      <button type="button" class="btn primary" onClick={() => start(PATHS[0])}>Start the tour</button></div>
  </Panel>;
}

function Menu({ finished }: { finished?: string }) {
  const p = progress.value;
  return <Panel title={finished ? `${finished}: done` : 'Tutorials'} wide>
    {finished && <p>Nicely done. Pick another, or close this and carry on: it is all in your name › Tutorials.</p>}
    <ul class="tour-paths">{PATHS.map((path) => {
      const done = p.done.includes(path.id), part = !done && p.at?.path === path.id;
      const mark = done ? '✓' : part ? '◐' : '○', state = done ? 'done' : part ? 'part-way' : 'not started';
      return <li><button type="button" class="tour-path" data-state={done ? 'done' : part ? 'part' : 'new'}
        onClick={() => start(path, part ? resumeAt(path) : 0)}>
        <span class="tour-mark" aria-hidden="true">{mark}</span>
        <span class="tour-path-name">{path.title}<span class="sr-only">{`, ${state}`}</span></span>
        <span class="tour-path-about">{path.about}</span>
        <span class="tour-path-len">{`${path.steps.length} steps · ~${path.minutes} min`}</span></button></li>;
    })}</ul>
  </Panel>;
}

const PAD = 6, GAP = 12, W = 340;
/** Where the card goes: below the ring, else above, else beside it; with no target, low in the middle. */
function place(b: Box | null, h: number) {
  const vw = innerWidth, vh = innerHeight, x = (v: number) => Math.max(GAP, Math.min(vw - W - GAP, v));
  if (!b) return { left: x((vw - W) / 2), top: vh - h - 48 };
  const below = b.y + b.h + PAD + GAP, above = b.y - PAD - GAP - h;
  if (below + h <= vh - GAP) return { left: x(b.x), top: below };
  if (above >= GAP) return { left: x(b.x), top: above };
  const right = b.x + b.w + PAD + GAP, top = Math.max(GAP, Math.min(vh - h - GAP, b.y));
  return { left: right + W <= vw - GAP ? right : x(b.x - PAD - GAP - W), top };
}

function StepCard() {
  const o = open.value as Extract<typeof open.value, { mode: 'step' }>, s = step.value!, c = ctx.value;
  const names = typeof s.anchor === 'function' ? s.anchor(c) : s.anchor, on = here.value;
  const el = pick(names), [box, setBox] = useState<Box | null>(null), [lost, setLost] = useState(false);
  const card = useRef<HTMLElement>(null), [h, setH] = useState(180);
  useLayoutEffect(() => (el ? follow(el, setBox) : setBox(null)), [el]);
  useLayoutEffect(() => { if (card.current) setH(card.current.offsetHeight); });
  useEffect(() => {   // a control still missing after 4 s: say so, and offer Skip
    setLost(false);
    if (el || !on) return undefined;
    const t = setTimeout(() => setLost(true), 4000);
    return () => clearTimeout(t);
  }, [el, on, o.i]);
  const p = on ? s.progress?.(c) : null, ring = on && box;
  const showMe = () => { el?.scrollIntoView({ block: 'center', inline: 'nearest' }); el?.focus({ preventScroll: true }); };
  const goTo = () => void navigate(o.path.start.includes('?') ? o.path.start : s.page!);
  return <>
    {ring ? <div class={cx('tour-ring', o.done && 'done')} style={{ left: `${box.x - PAD}px`, top: `${box.y - PAD}px`,
      width: `${box.w + 2 * PAD}px`, height: `${box.h + 2 * PAD}px` }} /> : <div class="tour-dim soft" />}
    <section ref={card} class={cx('tour-card tour-step', o.done && 'done')} role="dialog" aria-labelledby="tour-title"
      aria-label="Tutorial" style={place(ring ? box : null, h)}>
      <header class="tour-head"><span class="tour-count">{`${o.path.title} · ${o.i + 1} of ${o.path.steps.length}`}
      </span><button type="button" class="icon-btn tour-x" aria-label="Close the tutorial" onClick={close}>×</button>
      </header>
      <h2 id="tour-title">{s.title}</h2>
      <p>{fill(s.text, c, titles.value)}</p>
      {!on && <p class="tour-note">{`This step is in the ${s.page === '/studio' ? 'Studio' : humanize(s.page!.slice(1))}.`}
        <button type="button" class="btn small" onClick={goTo}>Go there</button></p>}
      {on && lost && <p class="tour-note">Cannot see it? It may be in a folded panel or another tab. Skip step moves
        on.</p>}
      {p && <meter class="tour-meter" min={0} max={p.goal} value={Math.min(p.now, p.goal)}
        aria-label={`${p.now.toFixed(2)} of ${p.goal}`} />}
      <p class="tour-status" role="status">{o.done ? 'Done.' : s.next ? '' : 'Waiting for you…'}</p>
      <div class="tour-actions">
        {el && <button type="button" class="btn small ghost" onClick={showMe}>Show me</button>}
        {!o.done && <button type="button" class="btn small ghost" onClick={next}>Skip step</button>}
        <button type="button" class="btn small primary" disabled={!o.done} onClick={next}>
          {o.i + 1 === o.path.steps.length ? 'Finish' : 'Next'}</button></div>
      {o.i === 0 && <button type="button" class="tour-link" onClick={() => menu()}>All tutorials</button>}
    </section>
  </>;
}
