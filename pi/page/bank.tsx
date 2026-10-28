// The bank (SPEC-liveplay "The page"): the playing look's own controls, 4 strips of one size a page, in its order
// (bpm is Tap, never a strip). A number strip is a vertical fader; held, it turns amber and its value releases it. The
// palette strip offers 4 palettes at a time, and a change blends. Empty slots are dashed. A look with none says why;
// while blacked out the bank is put away. Locked (someone else drives, or the link is lost), the strips are dashed
// and follow the state.
import { useEffect, useState } from 'preact/hooks';

import PALETTES from '../../public/data/palettes.json' with { type: 'json' };
import { cx } from '../../public/js/ui/kit.tsx';
import type { Control } from '../src/protocol.ts';
import { useDrag } from './drag.ts';
import { clock, label, type Model, since, useFits, useTick } from './model.ts';
import type { PiSocket } from './socket.ts';
import { SettingStrip } from './settings.tsx';

type Num = Extract<Control, { kind: 'macro' | 'bpm' }>;
type Pal = Extract<Control, { kind: 'palette' }>;
const PER = 4;
const GRADIENT = new Map(PALETTES.palettes.map((p) => [p.name,
  `linear-gradient(90deg, ${[p.low[0], p.body[Math.floor(p.body.length / 2)], p.accent[0], p.high[0]].join(', ')})`]));
const fixed = (c: Num, v: number) => (c.max - c.min > 10 ? v.toFixed(0) : v.toFixed(2));

export function Bank({ m, sock, wide }: { m: Model, sock: PiSocket, wide?: boolean }) {
  const { s } = m, look = s.look;
  const controls = look?.controls.filter((c) => c.kind !== 'bpm') ?? [];
  const pages = Math.max(1, Math.ceil(controls.length / PER));
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [look?.id]);
  const at = Math.min(page, pages - 1), shown = controls.slice(at * PER, at * PER + PER);
  if (s.blackout.on) return <Dark m={m} sock={sock} />;
  const locked = !m.knobs, range = !controls.length ? 'none' : m.lost ? 'last known'
    : `${at * PER + 1}–${at * PER + shown.length} of ${controls.length}`;
  const held = shown.filter((c) => c.held);
  return <>
    <div class="lp-tabs" role="group" aria-label="Knob bank">
      <button type="button" class="lp-pad lp-pg" disabled={at === 0} aria-label="Earlier knobs"
        onClick={() => setPage(at - 1)}>‹</button>
      <span class="lp-tab">This look <small>{range}</small></span>
      <button type="button" class="lp-pad lp-pg" disabled={at >= pages - 1} aria-label="More knobs"
        onClick={() => setPage(at + 1)}>›</button>
      {wide && controls.length > 0 && <button type="button" class="lp-pad" disabled={locked || !held.length}
        onClick={() => held.forEach((c) => sock.send({ type: 'release', name: c.name }))}>
        Reset these {shown.length}</button>}
    </div>
    {controls.length ? <div class={cx('lp-bank', locked && 'locked', m.lost && 'hatched')}
      aria-label={m.watching ? `Knobs, ${s.driver!.name}'s to move` : m.lost ? 'Knobs, paused until the lights answer'
        : 'Knobs'}>
      {shown.map((c) => (c.kind === 'palette'
        ? <PaletteStrip key={`${look!.id}:palette`} c={c} locked={locked} sock={sock} />
        : c.kind === 'choice' || c.kind === 'color'
          ? <SettingStrip key={`${look!.id}:${c.name}`} c={c} locked={locked} sock={sock} />
          : <NumberStrip key={`${look!.id}:${c.name}`} c={c} locked={locked} sock={sock} />))}
      {Array.from({ length: PER - shown.length }, (_, i) => <div key={`empty${i}`} class="lp-strip vacant">
        <span class="lp-sl">not offered</span></div>)}
    </div> : <Empty m={m} />}
  </>;
}

/** A number control: drag or arrow keys; its value below, or, held, "↺ value" to let it go. */
function NumberStrip({ c, locked, sock }: { c: Num, locked: boolean, sock: PiSocket }) {
  const f = useDrag({ min: c.min, max: c.max, value: c.value, axis: 'y', locked,
    send: (value) => sock.send({ type: 'set', name: c.name, value }) });
  return (
    <div class={cx('lp-strip', c.held && 'held')}>
      <span class="lp-sl" title={label(c.name)}>{label(c.name)}</span>
      <div class="lp-track" aria-label={label(c.name)} aria-valuetext={fixed(c, f.value)} {...f.props}>
        <i style={{ height: `${(f.share * 100).toFixed(1)}%` }} />
        <u style={{ bottom: `calc(${(f.share * 100).toFixed(1)}% - 2px)` }} />
      </div>
      {c.held && !locked
        ? <button type="button" class="lp-rel" aria-label={`Let ${label(c.name)} go back to the look's own`}
          onClick={() => { f.drop(); sock.send({ type: 'release', name: c.name }); }}>↺ {fixed(c, f.value)}</button>
        : <span class="lp-sv">{c.held && '↺ '}{fixed(c, f.value)}</span>}
    </div>);
}

/** The look's own palette, then the rest by name, 4 at a time (fewer when the strip is short). */
function PaletteStrip({ c, locked, sock }: { c: Pal, locked: boolean, sock: PiSocket }) {
  const options = [c.default, ...PALETTES.palettes.map((p) => p.name).filter((n) => n !== c.default)];
  const [page, setPage] = useState(0), [ref, fits] = useFits(44, 4), per = Math.min(PER, fits);
  const pages = Math.ceil(options.length / per), at = page % pages, shown = options.slice(at * per, at * per + per);
  const pick = (name: string) => sock.send({ type: 'palette', name: name === c.default ? '' : name });
  return (
    <div class={cx('lp-strip', c.held && 'held')}>
      <span class="lp-sl pal">Palette<small>a change blends</small></span>
      <div class="lp-pal" role="group" aria-label="Palette, a change blends" ref={ref as never}>
        {shown.map((name) => {
          const on = c.value === name;
          return <button key={name} type="button" class="lp-pb" aria-pressed={on} disabled={locked}
            onClick={() => pick(name)}>
            <span>{on && '✓ '}{name ? label(name) : 'The look\'s own'}</span>
            <i style={{ background: GRADIENT.get(name) ?? 'var(--night-3)' }} />
          </button>;
        })}
      </div>
      <div class="lp-pal-foot">
        {c.held && !locked && <button type="button" class="lp-rel"
          aria-label="Let the palette go back to the look's own"
          onClick={() => sock.send({ type: 'release', name: 'palette' })}>↺</button>}
        <button type="button" class="lp-pad lp-more" aria-label="More palettes"
          onClick={() => setPage((at + 1) % pages)}>More ›</button>
      </div>
    </div>);
}

/** No knobs: why, that Master and Blackout still work, and what the next one offers. */
function Empty({ m }: { m: Model }) {
  const l = m.s.look, next = m.next;
  return (
    <div class="lp-empty" role="note">
      <span class="lp-lock" aria-hidden="true" />
      {l ? <p><b>{l.title} has no knobs.</b>{l.kind === 'baked'
        ? ' It plays its bake: its colours and tempo were fixed when it was baked.' : ''}</p>
        : <p><b>Nothing is playing.</b> Pick a look from the queue.</p>}
      <p>Master and Blackout still work. {next ? <><b>{next.title}</b>, next, {next.kind === 'baked'
        ? 'is a bake too, with none.' : 'has its own knobs.'}</> : 'Nothing is queued.'}</p>
    </div>);
}

/** Blacked out: the knobs are put away, and the lights are dark. */
function Dark({ m, sock }: { m: Model, sock: PiSocket }) {
  const { blackout } = m.s, who = blackout.by === m.me?.name ? 'you' : blackout.by;
  useTick();
  return (
    <section class="lp-dark" role="alert" aria-label="Blackout is on">
      <span class="lp-sq" aria-hidden="true" />
      <h2>The lights are dark</h2>
      <p><b>Blackout is on</b>{who ? `: ${who} turned it on ${clock(blackout.ago + since(sock))} ago` : ''}. Every LED
        is off.</p>
      <p>The queue plays on underneath, unseen. The knobs are put away until the lights come back, so nothing changes
        in the dark.</p>
    </section>);
}
