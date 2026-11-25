// The list pages, My looks and the Gallery: cards that open in the Studio (lists carry metadata only; the Studio
// fetches a look). A card with a preview plays it through its glass, or shows its still under reduced motion
// (SPEC-previews). The gallery lists approved looks; a curator's can show the rest, to approve or hide
// (SPEC-access "Moderation").
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';
import { approved, can } from '../../../shared/policy.ts';
import type { Listed } from '../../../shared/schemas/api.ts';
import { setTitle, user, type ViewProps } from './session.ts';
import { Approve } from './approve.tsx';
import { deleteLook, mayDelete } from './delete-look.ts';
import { cx, jewelGradient, timeAgo } from './kit.tsx';
import { LookFiles } from './look-files.tsx';
import { Hide, ReportLook } from './moderate.tsx';
import { PhoneDisclosure } from './phone/disclosure.tsx';


const studioHref = (id: string) => `/studio/${encodeURIComponent(id)}`;
const previewHref = (l: Listed) => `/api/looks/${encodeURIComponent(l.id)}/preview/${l.preview}`;

export function Looks({ scope }: ViewProps) {
  const gallery = scope === 'gallery';
  const [looks, setLooks] = useState<Listed[] | null>(null), [error, setError] = useState('');
  const [q, setQ] = useState(''), [loads, setLoads] = useState(0);
  const curator = can(user.value, 'curate'), [approvedOnly, setApprovedOnly] = useState(true);
  useEffect(() => {
    setTitle(gallery ? 'Gallery' : 'My looks');
    let alive = true;
    api.looks(gallery ? 'gallery' : 'mine').then((r) => { if (alive) setLooks(r.looks || []); }).catch((err) => {
      setError(err.message);
    });
    return () => { alive = false; };
  }, [loads]);
  async function remove(look: Listed) {
    if (await deleteLook(look)) setLooks((all) => (all || []).filter((l) => l.id !== look.id));
  }

  const words = q.trim().toLowerCase();
  const changed = (look: Listed, patch: Partial<Listed>) => setLooks((all) => (all || []).map((l) => l.id === look.id
    ? { ...l, ...patch } : l));
  const waiting = gallery && curator ? (looks || []).filter((l) => !l.reviewed && !l.hidden).length : 0;
  const shown = (looks || []).filter((l) => (!gallery || !approvedOnly || approved(l)) && (!words
    || `${l.title} ${l.summary || ''} ${l.ownerName || ''}`.toLowerCase().includes(words)));
  const empty = error ? <p class="form-error">{error}</p> : looks?.length
    ? <p>{gallery && approvedOnly ? 'No approved looks match.' : 'No looks match that search.'}</p>
    : gallery ? <p>Nothing shared yet. Open one of your looks in the Studio and switch on “Share to gallery”.</p>
    : <p>No saved looks yet. <a href="/studio">Start a blank look</a>
      <span class="laptop-only">, or import some</span>.</p>;
  return (
    <div class="page looks-page">
      <div class="section-head page-head">
        <div><h1 class="page-title">{gallery ? 'Gallery' : 'My looks'}</h1>
          <p class="lede">{gallery ? 'Looks people have shared. Open one to watch it; edit it and Save makes it your '
            + 'own copy.' : 'Everything you have saved. Share one to put it in the gallery once a curator approves '
            + 'it.'}</p>
          {waiting > 0 && <p class="pane-hint">{`${waiting} shared look${waiting === 1 ? ' waits' : 's wait'} for `
            + `review${approvedOnly ? ': switch Approved off to see them' : ''}.`}</p>}</div>
        <div class="head-actions">
          <input type="search" class="search" aria-label="Search looks" value={q}
            placeholder={gallery ? 'Search the gallery' : 'Search my looks'}
            onInput={(e) => setQ(e.currentTarget.value)} />
          {gallery && curator && <button type="button" class={`btn ${approvedOnly ? 'primary' : 'ghost'}`}
            aria-pressed={approvedOnly} onClick={() => setApprovedOnly((on) => !on)}>Approved</button>}
          <LookFiles looks={looks} gallery={gallery} approvedOnly={approvedOnly || !curator}
            reload={() => setLoads((n) => n + 1)} />
          {!gallery && <a class="btn primary" href="/studio">New look</a>}
        </div>
      </div>
      <ul class="card-grid" aria-busy={!looks && !error}>
        {shown.map((look) => <Card key={look.id} look={look} gallery={gallery} remove={remove}
          changed={(patch) => changed(look, patch)} />)}</ul>
      <div class="empty" hidden={(!looks && !error) || shown.length > 0}>{empty}</div>
    </div>);
}

function Card({ look, gallery, remove, changed }: {
  look: Listed; gallery: boolean; remove: (l: Listed) => void; changed: (patch: Partial<Listed>) => void;
}) {
  const reviewed = look.reviewed, moderate = gallery && can(user.value, 'review', look);
  const reportable = gallery && look.owner !== user.value?.id, deletable = mayDelete(user.value, look, gallery);
  const n = look.layerCount ?? 0, href = studioHref(look.id);
  return (
    <li class="card">
      <div class={cx('card-art', look.preview && 'has-preview')} aria-hidden="true"
        style={{ '--art': jewelGradient(look.id + look.title) }}>
        {look.preview && <picture>
          <source media="(prefers-reduced-motion: reduce)" srcset={`${previewHref(look)}-still.webp`} />
          <img src={`${previewHref(look)}.webp`} alt="" loading="lazy" decoding="async" />
        </picture>}
      </div>
      <div class="card-body">
        <h2 class="card-title"><a href={href}>{look.title || 'Untitled look'}</a></h2>
        {look.summary && <p class="card-summary">{look.summary}</p>}
        <div class="card-meta">
          {gallery && <span class="meta-item">{`by ${look.ownerName || 'someone'}`}</span>}
          <span class="meta-item laptop-only">{`${n} layer${n === 1 ? '' : 's'}`}</span>
          <time class="meta-item laptop-only" dateTime={look.updatedAt || ''}>
            {timeAgo(look.updatedAt || look.createdAt)}</time>
          {look.shared && !gallery && <span class="tag tag-sapphire">Shared</span>}
          {reviewed && (!gallery || moderate) && <span class="tag tag-emerald">Reviewed</span>}
          {look.shared && !gallery && !reviewed && !look.hidden && <span class="tag">Waiting for review</span>}
          {look.hidden && (!gallery || moderate) && <span class="tag tag-amber">Hidden</span>}
        </div>
      </div>
      <div class="card-actions"><a class="btn small" href={href}>Open</a>
        {(moderate || reportable || deletable) && <PhoneDisclosure label="Actions">
        {moderate && !reviewed && <Approve look={look} approved={() => changed({ reviewed: true })} />}
        {moderate && <Hide look={look} changed={(hidden) => changed({ hidden })} />}
        {reportable && <ReportLook look={look} />}
        {deletable && <button class="btn small ghost danger-text" type="button"
          aria-label={`Delete ${look.title}`} onClick={() => remove(look)}>Delete</button>}
        </PhoneDisclosure>}
      </div>
    </li>);
}
