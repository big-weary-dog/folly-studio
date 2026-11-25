// Sign up, log in, or Try it: in as a guest in one click (spec/http "Guests").
import { useEffect, useId, useRef, useState } from 'preact/hooks';

import ACCOUNT from '../../data/account.json' with { type: 'json' };
import { api } from '../api.ts';
import { navigate, signedIn, user, type ViewProps } from './session.ts';
import { cx, Field } from './kit.tsx';
import { Rose } from './rose.tsx';
import { welcomeOnce } from './tour-view.ts';

export function Auth({ query }: ViewProps) {
  const [mode, setMode] = useState(query.get('mode') === 'signup' ? 'signup' : 'login');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const name = useRef<HTMLInputElement>(null), pass = useRef<HTMLInputElement>(null), errId = useId();
  const signup = mode === 'signup';
  // Focus the first field with a mouse; on a phone that would throw the keyboard over the page.
  useEffect(() => { if (matchMedia('(pointer: fine)').matches) name.current?.focus(); }, []);

  /** In by `come`, then back through the router, which sends a signed-in visitor on to a safe `next`. */
  async function enter(come: () => Promise<void>, field?: HTMLInputElement | null) {
    setBusy(true);
    try {
      await come();
      await navigate(location.pathname + location.search, { replace: true, force: true });
      welcomeOnce(user.value);
    } catch (err) {
      setError((err as Error).message);
      field?.focus();
      field?.select();
    } finally {
      setBusy(false);
    }
  }
  function submit(e: Event) {
    e.preventDefault();
    setError('');
    const u = name.current?.value.trim() || '', p = pass.current?.value || '';
    if (!u || !p) {
      setError('Enter a username and a password.');
      return (u ? pass : name).current?.focus();
    }
    void enter(async () => {
      await (signup ? api.signup(u, p) : api.login(u, p));
      signedIn(await api.me());
    }, pass.current);
  }
  const tryIt = () => { setError(''); void enter(async () => { signedIn(await api.guest()); }); };

  const tab = (m: string, text: string) => <button type="button" class="seg-btn" aria-pressed={mode === m}
    onClick={() => { setMode(m); setError(''); }}>{text}</button>;
  return (
    <div class="auth">
      <div class="auth-art"><Rose detail="full" /></div>
      <section class="auth-card">
        <h1 class="auth-title"><span class="kicker">The Gothic Folly</span>
          <svg class="wordmark" aria-hidden="true"><use href="#wordmark" /></svg>
          <span class="sr-only">Folly Studio</span></h1>
        <p class="auth-lede">Build a light show for the Folly — its arches, spires and sixteen-petal rose window —
          watch it come to life, tune it, and send it to the playa.</p>
        <div class="auth-try">
          <button class={cx('btn primary wide', busy && 'busy')} type="button" disabled={busy} onClick={tryIt}>
            Try it</button>
          <p class="field-hint">No account needed: play the looks and change them; your work stays in this browser.
            Saving needs an account.</p></div>
        <form class="auth-form" novalidate aria-describedby={errId} onSubmit={submit}>
          <div class="seg" role="group" aria-label="Log in or sign up">
            {tab('login', 'Log in')}{tab('signup', 'Sign up')}</div>
          <Field label="Username" stack>{(id) => <input id={id} ref={name} type="text" name="username"
            autocomplete="username" required autocapitalize="none" spellcheck={false}
            minlength={ACCOUNT.usernameMin} maxlength={ACCOUNT.usernameMax} />}
          </Field>
          <Field label="Password" stack hint={signup && <p class="field-hint">
            At least {ACCOUNT.passwordMin} characters. There is no email, so a forgotten password cannot be reset.
            Usernames are public in the gallery.</p>}>
            {(id) => <input id={id} ref={pass} name="password" type="password" required
              minlength={signup ? ACCOUNT.passwordMin : undefined}
              autocomplete={signup ? 'new-password' : 'current-password'} />}</Field>
          <p id={errId} class="form-error" role="alert" hidden={!error}>{error}</p>
          <button class={cx('btn wide', busy && 'busy')} type="submit" disabled={busy}>
            {signup ? 'Create account' : 'Log in'}</button>
        </form>
        <p class="auth-foot"><a href="/privacy">Privacy: what Studio keeps</a></p>
      </section>
    </div>);
}
