// The Access page, for admins (SPEC-access): invite codes (made with a use count and an expiry, shown once, revoked)
// and the people (unlocked or locked by hand, a raised allowance, their count reset).
import '../../css/access.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';
import { can } from '../../../shared/policy.ts';
import type { Invite, Person, PersonLimits } from '../../../shared/schemas/access.ts';
import { confirmDialog, cx, timeAgo, toast } from './kit.tsx';
import { setTitle } from './session.ts';

const STATE_TAG: Record<Invite['state'], string> = { active: 'tag-emerald', used: '', expired: 'tag-amber',
  revoked: 'danger-text' };
/** A link that signs the invitee up (or in) and redeems the code; the fragment keeps it out of server logs. */
const linkOf = (code: string) => `${location.origin}/#invite=${encodeURIComponent(code)}`;
const copy = (text: string) => navigator.clipboard.writeText(text)
  .then(() => toast('Copied.', { kind: 'ok' }), () => toast('Copy it by hand.'));
const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

export function AccessPage() {
  const [invites, setInvites] = useState<Invite[] | null>(null), [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState(''), [fresh, setFresh] = useState('');
  const fail = (err: unknown) => toast((err as Error).message, { kind: 'error' });
  useEffect(() => {
    setTitle('Access');
    api.invites().then((r) => setInvites(r.invites), (err) => setError((err as Error).message));
    api.people().then((r) => setPeople(r.people), (err) => setError((err as Error).message));
  }, []);
  const putPerson = (p: Person) => setPeople((all) => (all || []).map((x) => (x.id === p.id ? p : x)));
  async function revoke(inv: Invite) {
    const ok = await confirmDialog(`Revoke ${inv.label ? `“${inv.label}”` : 'this code'}? Nobody can redeem it after.`,
      { title: 'Revoke code', ok: 'Revoke', danger: true });
    if (!ok) return;
    try {
      const { invite } = await api.revokeInvite(inv.id);
      setInvites((all) => (all || []).map((x) => (x.id === invite.id ? invite : x)));
    } catch (err) { fail(err); }
  }
  return (
    <div class="page access-page">
      <h1 class="page-title">Access</h1>
      <p class="lede">Anyone can sign up to browse, edit and use the gallery. Turning ideas into looks needs an invite
        code, and each person's use is limited by <code>limits</code> in the models file.</p>
      {error && <p class="form-error" role="alert">{error}</p>}
      <section class="access-panel" aria-labelledby="codes-h">
        <h2 id="codes-h">Invite codes</h2>
        <NewCode made={(inv, code) => { setInvites((all) => [inv, ...(all || [])]); setFresh(code); }} fail={fail} />
        {fresh && <div class="fresh-code" role="status">
          <code>{fresh}</code>
          <button class="btn small" type="button" onClick={() => copy(fresh)}>Copy</button>
          <button class="btn small" type="button" onClick={() => copy(linkOf(fresh))}>Copy invite link</button>
          <span>Shown once: copy it now. Only its hash is kept.</span>
          <code class="invite-link">{linkOf(fresh)}</code></div>}
        <ul class="access-list" aria-busy={!invites}>
          {invites?.map((inv) => <li key={inv.id} class="access-row">
            <span class="access-name">{inv.label || 'No label'}</span>
            <span class={cx('tag', STATE_TAG[inv.state])}>{inv.state}</span>
            <span class="access-meta">{`${inv.used} of ${inv.uses} used · `}
              {inv.expiresAt ? `expires ${day(inv.expiresAt)}` : 'no expiry'}
              {` · by ${inv.createdBy} ${timeAgo(inv.createdAt)}`}</span>
            {inv.state === 'active' && <button class="btn ghost small danger-text" type="button"
              onClick={() => revoke(inv)}>Revoke</button>}
          </li>)}
          {invites?.length === 0 && <li class="pane-hint">No codes yet.</li>}
        </ul>
      </section>
      <section class="access-panel" aria-labelledby="people-h">
        <h2 id="people-h">People</h2>
        <People people={people} put={putPerson} fail={fail} />
      </section>
    </div>);
}

function NewCode({ made, fail }: { made: (inv: Invite, code: string) => void, fail: (err: unknown) => void }) {
  const [label, setLabel] = useState(''), [uses, setUses] = useState('1'), [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  async function make(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.createInvite({ label: label.trim() || undefined, uses: Number(uses) || 1,
        days: Number(days) || undefined });
      made(r.invite, r.code);
      setLabel('');
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  return (
    <form class="new-code" onSubmit={make}>
      <label>Label<input type="text" value={label} maxlength={60} placeholder="Who it is for"
        onInput={(e) => setLabel(e.currentTarget.value)} /></label>
      <label>Uses<input type="number" min={1} max={1000} value={uses}
        onInput={(e) => setUses(e.currentTarget.value)} /></label>
      <label>Expires in days<input type="number" min={1} max={365} value={days} placeholder="Never"
        onInput={(e) => setDays(e.currentTarget.value)} /></label>
      <button class={cx('btn primary', busy && 'busy')} type="submit" disabled={busy}>Make a code</button>
    </form>);
}

function People({ people, put, fail }: { people: Person[] | null, put: (p: Person) => void,
  fail: (err: unknown) => void }) {
  const [q, setQ] = useState(''), [open, setOpen] = useState('');
  const change = (p: Person, patch: Parameters<typeof api.updatePerson>[1]) => api.updatePerson(p.id, patch)
    .then((r) => put(r.person), fail);
  const words = q.trim().toLowerCase(), shown = (people || []).filter((p) => p.username.includes(words));
  return <>
    <input type="search" class="search" aria-label="Search people" placeholder="Search people" value={q}
      onInput={(e) => setQ(e.currentTarget.value)} />
    <ul class="access-list" aria-busy={!people}>
      {shown.map((p) => {
        const admin = can(p, 'admin'), unlocked = admin || !!p.access.unlockedAt;
        return <li key={p.id} class="access-row">
          <span class="access-name">{p.username}</span>
          <span class={cx('tag', admin ? 'tag-sapphire' : unlocked ? 'tag-emerald' : '')}>
            {admin ? 'admin' : unlocked ? 'unlocked' : 'locked'}</span>
          <span class="access-meta">{`${p.used.hour} this hour · ${p.used.day} today · ${p.used.running} now`}
            {p.access.limits ? ' · own limits' : ''}</span>
          {!admin && <span class="access-actions">
            <button class="btn ghost small" type="button" onClick={() => change(p, { unlocked: !unlocked })}>
              {unlocked ? 'Lock' : 'Unlock'}</button>
            <button class="btn ghost small" type="button" onClick={() => change(p, { reset: true })}>Reset</button>
            <button class="btn ghost small" type="button" aria-expanded={open === p.id}
              onClick={() => setOpen(open === p.id ? '' : p.id)}>Limits</button></span>}
          {open === p.id && <LimitsForm p={p} save={(limits) => change(p, { limits })} />}
        </li>;
      })}
    </ul></>;
}

/** One person's own limits: blank fields take the models file's. */
function LimitsForm({ p, save }: { p: Person, save: (limits: PersonLimits | null) => void }) {
  const [v, setV] = useState({ perHour: '', perDay: '', concurrent: '',
    ...Object.fromEntries(Object.entries(p.access.limits ?? {}).map(([k, n]) => [k, String(n)])) });
  const field = (key: keyof typeof v, label: string) => <label>{label}<input type="number" min={0} value={v[key]}
    placeholder="Default" onInput={(e) => setV({ ...v, [key]: e.currentTarget.value })} /></label>;
  const limits = Object.fromEntries(Object.entries(v).filter(([, s]) => s !== '').map(([k, s]) => [k, Number(s)]));
  return (
    <form class="limits-form" onSubmit={(e) => { e.preventDefault(); save(limits); }}>
      {field('perHour', 'An hour')}{field('perDay', 'A day')}{field('concurrent', 'At once')}
      <button class="btn small" type="submit">Save</button>
      <button class="btn ghost small" type="button" onClick={() => save(null)}>Defaults</button>
    </form>);
}
