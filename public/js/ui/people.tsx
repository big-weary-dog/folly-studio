// The People page, for admins (spec/http "People"): every account, newest first, with its role, looks and state;
// an admin changes another's role, disables or enables it, or deletes it after a confirm. Their own row is Account's.
import '../../css/people.css';

import { useEffect, useState } from 'preact/hooks';

import { ROLES, type Role } from '../../../shared/policy.ts';
import type { Account } from '../../../shared/schemas/api.ts';
import { api } from '../api.ts';
import { confirmDialog, cx, timeAgo, toast } from './kit.tsx';
import { setTitle, user } from './session.ts';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const ROLE_NAMES: Record<Role, string> = { member: 'Member', curator: 'Curator', admin: 'Admin' };

export function PeoplePage() {
  const [list, setList] = useState<Account[] | null>(null), [error, setError] = useState(''), [q, setQ] = useState('');
  useEffect(() => {
    setTitle('People');
    api.accounts().then((r) => setList(r.accounts), (err) => setError((err as Error).message));
  }, []);
  const put = (next: Account) => setList((l) => l && l.map((a) => (a.id === next.id ? next : a)));
  const drop = (id: string) => setList((l) => l && l.filter((a) => a.id !== id));
  const shown = list?.filter((a) => a.username.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div class="page people-page">
      <h1 class="page-title">People</h1>
      <p class="lede">Every account: change its role, disable it so it cannot sign in, or delete it with its looks.</p>
      <input type="search" class="search people-search" aria-label="Search people" placeholder="Search people"
        value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      {!shown ? <p class={error ? 'form-error' : 'pane-hint'}>{error || 'Loading…'}</p>
        : !shown.length ? <p class="pane-hint">{list!.length ? 'Nobody by that name.' : 'No accounts yet.'}</p>
        : <ul class="people-list">{shown.map((a) => <Person key={a.id} a={a} put={put} drop={drop} />)}</ul>}
    </div>);
}

function Person({ a, put, drop }: { a: Account, put: (a: Account) => void, drop: (id: string) => void }) {
  const [busy, setBusy] = useState(false), mine = a.id === user.value?.id;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); } catch (err) { toast((err as Error).message, { kind: 'error' }); } finally { setBusy(false); }
  };
  const change = (body: { role?: Role, disabled?: boolean }) => run(async () =>
    put((await api.changeAccount(a.id, body)).account));
  const remove = () => run(async () => {
    const looks = a.looks ? ` and ${a.looks === 1 ? 'its look' : `its ${a.looks} looks`}${a.shared
      ? ` (${a.shared} shared in the gallery)` : ''}` : '';
    if (!await confirmDialog(`Delete the account ${a.username}${looks}? This cannot be undone.`,
      { title: 'Delete account', ok: 'Delete account', danger: true })) return;
    await api.removeAccount(a.id);
    drop(a.id);
    toast(`${a.username} was deleted.`);
  });
  const lowest = a.serverRole ? ROLES.indexOf(a.serverRole) : 0;
  return (
    <li class={cx('people-row', a.disabled && 'disabled')}>
      <div class="people-who">
        <span class="people-name">{a.username}{mine && <span class="tag">You</span>}
          {a.disabled && <span class="tag people-off">Disabled</span>}</span>
        <span class="people-meta">
          <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>joined {timeAgo(a.createdAt)}
          </time> · {plural(a.looks, 'look')}{a.shared ? `, ${a.shared} shared` : ''}</span>
      </div>
      <label class="people-role">Role
        <select value={a.role} disabled={busy || mine}
          onChange={(e) => change({ role: e.currentTarget.value as Role })}
          title={a.serverRole && `At least ${ROLE_NAMES[a.serverRole].toLowerCase()} by the server's settings`}>
          {ROLES.slice(lowest).map((r) => <option value={r}>{ROLE_NAMES[r]}</option>)}
        </select></label>
      {mine ? <a class="btn ghost small" href="/account">Account</a> : <div class="people-actions">
        <button class="btn ghost small" type="button" disabled={busy}
          onClick={() => change({ disabled: !a.disabled })}>{a.disabled ? 'Enable' : 'Disable'}</button>
        <button class="btn ghost small danger" type="button" disabled={busy} onClick={remove}>Delete…</button>
      </div>}
    </li>);
}
