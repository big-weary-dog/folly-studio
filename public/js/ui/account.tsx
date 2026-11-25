// The Account page (SPEC-access "Your account"): a new password, or the account deleted with its looks. There is no
// email, so a lost password cannot be reset; the page says so.
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import ACCOUNT from '../../data/account.json' with { type: 'json' };
import { api } from '../api.ts';
import { confirmDialog, cx, Field, toast } from './kit.tsx';
import { leaveGuard, navigate, setTitle, user } from './session.ts';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A form's submit: its fields as text, the form reset when `run` succeeds, its error shown when not. */
function useForm(run: (fields: Record<string, string>) => Promise<unknown>) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    setError('');
    setBusy(true);
    try {
      if ((await run(Object.fromEntries(new FormData(form)) as Record<string, string>)) !== false) form.reset();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return { error, busy, submit };
}

function PasswordForm() {
  const { error, busy, submit } = useForm(async ({ password, next }) => {
    await api.changePassword(password, next);
    toast('Password changed. Any other device you were signed in on is signed out.', { kind: 'ok' });
  });
  return (
    <form class="models-panel account-form" aria-labelledby="password-h" onSubmit={submit}>
      <h2 id="password-h">Change password</h2>
      <Field label="Current password" stack>{(id) => <input id={id} name="password" type="password" required
        autocomplete="current-password" />}</Field>
      <Field label="New password" stack hint={<p class="field-hint">At least {ACCOUNT.passwordMin} characters.</p>}>
        {(id) => <input id={id} name="next" type="password" required minlength={ACCOUNT.passwordMin}
          autocomplete="new-password" />}</Field>
      <p class="form-error" role="alert" hidden={!error}>{error}</p>
      <div class="models-actions">
        <button class={cx('btn primary', busy && 'busy')} type="submit" disabled={busy}>Change password</button></div>
    </form>);
}

function DeleteForm() {
  const [looks, setLooks] = useState<{ all: number, shared: number } | null>(null);
  useEffect(() => {
    api.looks('mine').then(({ looks: list = [] }) => setLooks({ all: list.length,
      shared: list.filter((l) => l.shared).length }), () => {});
  }, []);
  const { error, busy, submit } = useForm(async ({ password }) => {
    const n = looks ?? { all: 0, shared: 0 };
    const what = n.all ? ` and its ${plural(n.all, 'look')}${n.shared ? ` (${n.shared} shared in the gallery)` : ''}`
      : '';
    const ok = await confirmDialog(`Delete the account ${user.value?.username}${what}? This cannot be undone.`,
      { title: 'Delete account', ok: 'Delete account', danger: true });
    if (!ok) return false;
    await api.deleteAccount(password);
    leaveGuard.discard?.();
    user.value = null;
    toast('Your account was deleted.');
    await navigate('/login', { force: true, replace: true });
    return true;
  });
  return (
    <form class="models-panel account-form account-danger" aria-labelledby="delete-h" onSubmit={submit}>
      <h2 id="delete-h">Delete account</h2>
      <p class="field-hint">This deletes your account and every look you made
        {looks && looks.all > 0 && <> ({plural(looks.all, 'look')}{looks.shared > 0 && `, ${looks.shared} shared`})</>}:
        shared looks leave the gallery and the live stage. Copies other people saved are theirs and stay.</p>
      <Field label="Your password" stack>{(id) => <input id={id} name="password" type="password" required
        autocomplete="current-password" />}</Field>
      <p class="form-error" role="alert" hidden={!error}>{error}</p>
      <div class="models-actions">
        <button class={cx('btn danger', busy && 'busy')} type="submit" disabled={busy}>Delete account…</button></div>
    </form>);
}

export function AccountPage() {
  useEffect(() => setTitle('Account'), []);
  return (
    <div class="page account-page">
      <h1 class="page-title">Account</h1>
      <p class="lede">Signed in as <strong>{user.value?.username}</strong>. Folly Studio has no email, so a forgotten
        password cannot be reset: keep it somewhere safe, such as a password manager.</p>
      <PasswordForm />
      <DeleteForm />
    </div>);
}
