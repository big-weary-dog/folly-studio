// The Versions tab: the look's saved versions, newest first (GET /api/looks/:id/versions), each with a strip of its
// palette, to preview, restore or name (named.tsx). Only the owner sees them; the gallery and curators see only the
// look as saved.
import { useEffect, useState } from 'preact/hooks';

import type { VersionListed } from '../../../../shared/schemas/api.ts';
import { api } from '../../api.ts';
import { cx, timeAgo, toast } from '../kit.tsx';
import type { Studio } from '../studio-store.ts';
import { rename, saveNamed } from './named.tsx';

const quoted = (s: string) => `“${s.length > 48 ? `${s.slice(0, 47)}…` : s}”`;
/** A version's name: its own, or how it was made. */
export const nameOf = (v: VersionListed) => v.name ?? (v.how === 'ai' ? (v.ask ? `AI: ${quoted(v.ask)}` : 'An AI round')
  : v.how === 'restore' ? `Restored version ${v.from ?? ''}` : 'Saved');
const ROLES = ['low', 'body', 'accent', 'high'] as const;
/** Up to 8 of a palette's colours, a role at a time. */
function colours(palette: unknown) {
  const p = (palette ?? {}) as Record<string, unknown>;
  const lists = ROLES.map((r) => (Array.isArray(p[r]) ? p[r] as string[] : []));
  return Array.from({ length: 8 }, (_, i) => lists.map((l) => l[i])).flat().filter(Boolean).slice(0, 8);
}

export function Versions({ st, open }: { st: Studio, open: boolean }) {
  const id = st.look.value.id, saved = st.server.value?.version, pv = st.previewing.value;
  const [list, setList] = useState<VersionListed[] | null>(null), [busy, setBusy] = useState(0);
  const [asked, setAsked] = useState(0);   // a named save: the list again, even when no version was made
  useEffect(() => {
    if (!open || !id) return;
    let live = true;
    api.versions(id).then((r) => { if (live) setList(r.versions); }, (err) => toast(err.message, { kind: 'error' }));
    return () => { live = false; };
  }, [open, id, saved, asked]);
  const named = async (v: VersionListed) => {
    const now = await rename(st, v);
    if (now) setList((l) => l?.map((x) => (x.n === now.n ? now : x)) ?? null);
  };
  const show = async (v: VersionListed) => {
    if (!id) return;
    if (pv?.n === v.n) { st.back(); return; }
    setBusy(v.n);
    try { st.preview((await api.version(id, v.n)).version, nameOf(v)); }
    catch (err) { toast((err as Error).message, { kind: 'error' }); }
    finally { setBusy(0); }
  };
  const work = colours(st.work.value.globals?.palette);
  if (st.copyOnSave.value) {
    return <p class="history-hint">Versions are the owner's. Save your own copy to keep yours.</p>;
  }
  if (!id) return <p class="history-hint">Save the look, and each save that changes what plays keeps a version.</p>;
  return <>
    {pv ? <div class="version-preview" role="status">
      <p><strong>Previewing version {pv.n}</strong>{` · ${pv.label}. Your work is kept; editing is off until you `
        + 'go back.'}</p>
      <div class="version-actions">
        <button type="button" class="btn small primary" disabled={st.saving.value} onClick={() => st.restore()}>
          Restore this version</button>
        <button type="button" class="btn small" onClick={() => st.back()}>Back to my work</button>
      </div></div>
      : <div class="version-top"><p class="pane-hint">{st.dirty.value ? 'Unsaved changes: Save keeps them as a new '
        + 'version.' : 'Each Save that changes what plays keeps a version.'}</p>
        <button type="button" class="btn small" disabled={st.saving.value} onClick={async () => {
          if (await saveNamed(st)) setAsked((n) => n + 1);
        }}>
          Save a named version…</button></div>}
    <ul class="version-list" aria-label="Saved versions, newest first">
      {(st.dirty.value || pv) && <li class={cx('version', 'is-work', !pv && 'is-current')}>
        <Strip colours={work.length ? work : list?.[0]?.palette ?? []} />
        <div class="version-text"><span class="version-name-t">Your work</span>
          <span class="version-meta">{st.dirty.value ? 'now · not saved' : 'now'}</span></div>
        {pv && <button type="button" class="btn small" onClick={() => st.back()}>Back</button>}</li>}
      {list?.map((v) => <li class={cx('version', `h-${v.how}`, v.name && 'is-named', v.n === pv?.n && 'is-current')}>
        <Strip colours={v.palette} />
        <div class="version-text">
          <span class="version-name-t" title={nameOf(v)}>{nameOf(v)}</span>
          <span class="version-meta">{`v${v.n} · ${timeAgo(v.savedAt)} · ${v.layerCount} layer`
            + `${v.layerCount === 1 ? '' : 's'} · ${v.duration} s${v.bpm ? ` · ${v.bpm} bpm` : ''}`}</span>
          {(v.current || v.reviewed || v.name) && <span class="version-tags">
            {v.name && <span class="tag t-named" title="Named: kept until you unname it">Named</span>}
            {v.current && <span class="tag" title="The look as saved">Saved</span>}
            {v.shared && <span class="tag t-gallery" title="The gallery shows this version">In gallery</span>}
            {v.reviewed && <span class="tag t-review" title="A curator reviewed this version: it plays on Live">
              Reviewed</span>}</span>}
        </div>
        <div class="version-btns">
          <button type="button" class="icon-btn" aria-label={`Name version ${v.n}`} title="Name it (keeps it)"
            onClick={() => named(v)}>✎</button>
          <button type="button" class="btn small" aria-pressed={v.n === pv?.n} disabled={busy === v.n}
            onClick={() => show(v)}>{v.n === pv?.n ? 'Previewing' : 'Preview'}</button></div>
      </li>)}</ul>
    {list && !list.length && <p class="pane-hint">No versions yet.</p>}
    <p class="history-hint">Versions are yours alone: the gallery shows only what you share, and a curator reviews one
      version. Kept: every named one, and the last 20 others.</p></>;
}

/** A version's thumbnail: a strip of LEDs in its colours. */
function Strip({ colours: list }: { colours: string[] }) {
  return <span class="version-strip" aria-hidden="true">{list.map((c) => <i ref={(el) => {
    el?.style.setProperty('--c', c);
  }} />)}</span>;
}
