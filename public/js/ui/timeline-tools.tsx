// The timeline's controls: length and tempo, snapping, zoom, adding a clip, importing a look, and the selected
// clip's numbers (wide: in the dock's head, in place of length and tempo; phones: below the strips). "Import look…"
// picks one of my looks or a gallery look to play after this one.
import { useEffect, useId, useState } from 'preact/hooks';

import { api } from '../api.ts';
import type { Listed } from '../../../shared/schemas/api.ts';
import { cx, openDialog } from './kit.tsx';
import type { Studio } from './studio-store.ts';
import { optionText } from './bindings.ts';
import {
  cleanBpm, cleanDuration, clock, DEFAULT_DURATION, editClip, MAX_DURATION, setTransition, transitionKey, WIPES,
} from './timeline-model.ts';
import type { TimelineState } from './timeline-state.ts';

const SNAPS = [['grid', 'Snap ¼ s'], ['beat', 'Snap beats'], ['off', 'No snap']];
const show = (v?: number | null) => (v === null || v === undefined ? '' : String(Math.round(v * 1000) / 1000));
type Props = { st: Studio; tl: TimelineState };

/** A labelled number box that commits on change (Enter leaves it) and never overwrites what is being typed. */
function Num({ label, unit, value, commit, keep, ...attrs }: { label: string; unit?: string; value?: number | null;
  commit: (typed: string, el: HTMLInputElement) => void; keep?: boolean; min?: number; max?: number; step?: number;
  title?: string; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <span class="tl-field"><label for={id} class={cx('tl-label', keep && 'keep')}>{label}</label>
      <input id={id} type="number" class="tl-num" inputMode="decimal" {...attrs}
        value={document.activeElement?.id === id ? undefined : show(value)}
        onChange={(e) => commit(e.currentTarget.value, e.currentTarget)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      {unit && <span class="tl-unit">{unit}</span>}</span>);
}

const Btn = ({ text, label, onClick, cls = 'tl-btn', disabled }: { text: string; label: string; onClick: () => void;
  cls?: string; disabled?: boolean }) =>
  <button type="button" class={cls} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
    {text}</button>;

function AddClip({ st, tl }: Props) {
  return <button type="button" class="btn small tl-add" title="Add a clip to the selected layer at the playhead"
    disabled={!st.selected.value} onClick={() => tl.addClipAt(st.selected.peek(), tl.now())}>+ Clip</button>;
}

/** Wide: everything, the selected clip's numbers in place of the rest; phones: the look's and the view's tools. */
export function TimelineTools({ st, tl, inspector }: Props & { inspector?: boolean }) {
  const L = st.look.value;
  return (
    <div class={cx('tl-tools', tl.selected.value && 'has-clip')}>
      <span class="tl-look-tools">
        <Num label="Length" unit="s" min={1} max={MAX_DURATION} step={0.25} value={tl.duration.value}
          title="How long the look runs before it loops, in seconds" commit={(typed, el) => {
            const d = cleanDuration(typed);
            if (d !== tl.duration.peek()) tl.setDuration(d); else el.value = show(d);
          }} />
        <Num label="BPM" min={40} max={240} step={1} placeholder="BPM" value={L.bpm}
          title="Tempo in beats per minute (120 unset): the beat grid, LFOs in beats, tempo bindings"
          commit={(typed, el) => {
            const bpm = cleanBpm(typed.trim());
            if (typed.trim() && !bpm) el.value = show(st.look.peek().bpm);
            else if (bpm !== (st.look.peek().bpm || null)) tl.setBpm(bpm);
          }} />
        <button type="button" class="btn small tl-import" title="Import a look: play another look after this one"
          onClick={() => importLookDialog(st, tl)}>Import look…</button>
      </span>
      <span class="tl-view-tools">
        <select class="tl-snap" aria-label="Snapping" value={tl.snap.value}
          onChange={(e) => tl.setSnap(e.currentTarget.value)}>
          {SNAPS.map(([v, t]) => <option value={v} disabled={v === 'beat' && !L.bpm}>{t}</option>)}</select>
        <span class="tl-zoom" role="group" aria-label="Zoom">
          <Btn text="−" label="Zoom out (Ctrl+wheel)" onClick={() => tl.zoom(1 / 1.6)} />
          <Btn text="+" label="Zoom in (Ctrl+wheel)" onClick={() => tl.zoom(1.6)} />
          <Btn text="Fit" label="Fit the whole look" cls="tl-btn tl-fit" onClick={tl.zoomToFit} /></span>
        {!st.narrow.value && <AddClip st={st} tl={tl} />}
      </span>
      {inspector && <Inspector st={st} tl={tl} />}
    </div>);
}

/** The selected clip's numbers. */
export function Inspector({ st, tl }: Props) {
  const s = tl.selected.value, layer = st.selected.value;
  type Time = 'start' | 'end' | 'fadeIn' | 'fadeOut';
  const edit = (key: Time) => (typed: string, el: HTMLInputElement) => {
    const now = tl.selected.peek();
    if (!now) return;
    const next = editClip(now.layer.clips || [], now.index, { [key]: Number(typed) }, tl.limit(now.clip));
    if (next) tl.setClips(now.layer.id, next); else el.value = show(now.clip[key]);
  };
  const field = (key: Time, label: string) => <Num key={key} label={label} keep min={0} max={MAX_DURATION}
    step={0.05} title={`${label}, in seconds`} value={s ? s.clip[key] : null} disabled={!s} commit={edit(key)} />;
  return (
    <div class={cx('tl-inspector', !s && 'none')} role="group" aria-label="Selected clip">
      <span class="tl-clip-name">{s ? `${s.layer.title || 'Layer'} · clip ${s.index + 1}/${s.layer.clips?.length}`
        : layer ? `${layer.title || 'Layer'}: tap a clip to edit it` : 'No layer selected'}</span>
      {field('start', 'Start')}{field('end', 'End')}{field('fadeIn', 'Fade in')}{field('fadeOut', 'Fade out')}
      <select class="tl-transition" aria-label="How the fades show" title="How the fades show" disabled={!s}
        value={s ? transitionKey(s.clip) : 'fade'} onChange={(e) => {
          const now = tl.selected.peek();
          if (now) tl.setClips(now.layer.id, setTransition(now.layer.clips || [], now.index, e.currentTarget.value));
        }}>
        <option value="fade">Fade</option>
        {WIPES.map((d) => <option value={`wipe:${d}`}>{`Wipe ${optionText(d, [...WIPES])}`}</option>)}
      </select>
      {st.narrow.value && <AddClip st={st} tl={tl} />}
      <Btn text="Remove" label="Remove this clip (Delete)" cls="tl-btn tl-del" disabled={!s}
        onClick={tl.removeSelected} />
      <Btn text="Done" label="Done with this clip (Esc)" cls="tl-btn tl-done" disabled={!s}
        onClick={() => { if (s) tl.selectClip(s.layer.id, null); }} />
    </div>);
}

const SCOPES = { mine: 'My looks', gallery: 'Gallery' } as const;

/** The picker; this look is listed last (importing it repeats it). */
function importLookDialog(st: Studio, tl: TimelineState) {
  const currentId = st.look.peek().id, cache = new Map<string, Listed[]>();
  return openDialog<boolean>({ title: 'Import a look', className: 'import-dialog', body: (close) => {
    const [scope, setScope] = useState<keyof typeof SCOPES | null>(null);
    const [list, setList] = useState<Listed[] | string>('Loading…'), [status, setStatus] = useState('');
    /** An API call → its result, or null after saying why. */
    const ask = <T,>(call: Promise<T>, said: (m: string) => void) => call.catch((err) => {
      said(err.message);
      return null;
    });
    async function show(to: keyof typeof SCOPES) {
      setScope(to);
      setStatus('');
      setList('Loading…');
      const looks = cache.get(to) || (await ask(api.looks(to), setList))?.looks;
      if (!looks) return;
      cache.set(to, looks);
      const sorted = looks.filter((l) => l.id !== currentId).concat(looks.filter((l) => l.id === currentId));
      setList(sorted.length ? sorted : to === 'mine' ? 'You have no saved looks yet.' : 'The gallery is empty.');
    }
    async function pick(look: Listed) {
      const full = (await ask(api.look(look.id), setStatus))?.look;
      const error = full && tl.importLook(full);
      if (error) setStatus(error); else if (full) close(true);
    }
    useEffect(() => { show('mine'); }, []);
    return <>
      <p class="dialog-text">Its layers are added to this look, each with a clip that starts where this look’s content
        ends. Layers here that play throughout end there, so the two follow each other.</p>
      <div class="import-tabs" role="group" aria-label="Which looks">
        {Object.entries(SCOPES).map(([k, text]) => <button type="button" class="tab import-tab"
          aria-pressed={scope === k} onClick={() => show(k as keyof typeof SCOPES)}>{text}</button>)}</div>
      <ul class="library-list import-list" aria-live="polite">
        {typeof list === 'string' ? <li class="pane-hint">{list}</li> : list.map((look) => {
          const n = look.layerCount;     // lists carry metadata only
          const meta = `${n} layer${n === 1 ? '' : 's'} · ${clock(look.duration || DEFAULT_DURATION)}`
            + `${look.id === currentId ? ' · this look (saved version)' : ''}`
            + `${scope === 'gallery' && look.ownerName ? ` · by ${look.ownerName}` : ''}`;
          return <li><button type="button" class="library-item" onClick={() => pick(look)}>
            <span class="library-title">{look.title || 'Untitled look'}</span>
            <span class="library-summary">{meta}</span></button></li>;
        })}</ul>
      <p class="import-status" role="status">{status}</p>
    </>;
  } });
}
