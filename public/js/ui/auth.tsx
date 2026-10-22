// Sign up, log in, or in as a guest with a name alone (SPEC-access "Guests").
import { useEffect, useId, useRef, useState } from 'preact/hooks';

import ACCOUNT from '../../data/account.json' with { type: 'json' };
import { api } from '../api.ts';
import { pendingInvite, redeemInvite } from './invite.ts';
import { navigate, onPi, signedIn, user, type ViewProps } from './session.ts';
import { cx, Field } from './kit.tsx';
import { Rose } from './rose.tsx';
import { welcomeOnce } from './tour-view.ts';

export function Auth({ query }: ViewProps) {
  const invited = !!pendingInvite();
  const [mode, setMode] = useState(query.get('mode') === 'signup' || invited ? 'signup' : 'login');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const name = useRef<HTMLInputElement>(null), pass = useRef<HTMLInputElement>(null), errId = useId();
  const signup = mode === 'signup', guest = mode === 'guest';
  // Focus the first field with a mouse; on a phone that would throw the keyboard over the page.
  useEffect(() => { if (matchMedia('(pointer: fine)').matches) name.current?.focus(); }, []);

  async function submit(e: Event) {
    e.preventDefault();
    setError('');
    const u = name.current?.value.trim() || '', p = pass.current?.value || '';
    if (guest ? !u : !u || !p) {
      setError(guest ? 'Enter a name.' : 'Enter a username and a password.');
      return (u ? pass : name).current?.focus();
    }
    setBusy(true);
    try {
      if (guest) signedIn(await api.guest(u));
      else {
        await (signup ? api.signup(u, p) : api.login(u, p));
        signedIn(await api.me());
        if (!onPi()) await redeemInvite();
      }
      // Back through the router, which sends a signed-in visitor on to a safe `next`.
      await navigate(location.pathname + location.search, { replace: true, force: true });
      welcomeOnce(user.value);
    } catch (err) {
      setError((err as Error).message);
      const field = (guest ? name : pass).current;
      field?.focus();
      field?.select();
    } finally {
      setBusy(false);
    }
  }

  const tab = (m: string, text: string) => <button type="button" class="seg-btn" aria-pressed={mode === m}
    onClick={() => { setMode(m); setError(''); }}>{text}</button>;
  return (
    <div class="auth">
      <div class="auth-art"><Rose detail="full" /></div>
      <section class="auth-card">
        <h1 class="auth-title"><span class="kicker">The Gothic Folly</span>
          <svg class="wordmark" aria-hidden="true"><use href="#wordmark" /></svg>
          <span class="sr-only">Folly Studio</span></h1>
        <p class="auth-lede">Describe a show for 4,870 LEDs — arches, spires, a sixteen-petal rose window — watch it
          come to life, tune it, and send it to the playa.</p>
        {invited && <p class="auth-invited" role="status"><strong>You've been invited.</strong> Sign up, or log in if
          you have an account, and your invite to the AI models is accepted.</p>}
        <form class="auth-form" novalidate aria-describedby={errId} onSubmit={submit}>
          <div class="seg" role="group" aria-label="Log in, sign up, or come in as a guest">
            {tab('login', 'Log in')}{tab('signup', 'Sign up')}{tab('guest', 'Guest')}</div>
          {guest ? <Field key="guest" label="Your name" stack hint={<p class="field-hint">No account needed: make
            patterns, and your work stays in this browser. Saving needs an account.</p>}>
            {(id) => <input id={id} ref={name} type="text" name="nickname" autocomplete="nickname" required
              maxlength={24} />}</Field>
            : <><Field label="Username" stack>{(id) => <input id={id} ref={name} type="text" name="username"
              autocomplete="username" required autocapitalize="none" spellcheck={false}
              minlength={ACCOUNT.usernameMin} maxlength={ACCOUNT.usernameMax} />}
            </Field>
            <Field label="Password" stack hint={signup && <p class="field-hint">
              At least {ACCOUNT.passwordMin} characters. Usernames are public in the gallery.</p>}>
              {(id) => <input id={id} ref={pass} name="password" type="password" required
                minlength={signup ? ACCOUNT.passwordMin : undefined}
                autocomplete={signup ? 'new-password' : 'current-password'} />}</Field></>}
          <p id={errId} class="form-error" role="alert" hidden={!error}>{error}</p>
          <button class={cx('btn primary wide', busy && 'busy')} type="submit" disabled={busy}>
            {signup ? 'Create account' : guest ? 'Come in as a guest' : 'Log in'}</button>
        </form>
      </section>
    </div>);
}
