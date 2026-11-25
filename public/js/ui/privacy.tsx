// The privacy page (spec/http "Privacy"): what Studio keeps, for how long, and how to delete it. Open signed in or
// not; the reports' days come from the server, so the page states the setting in force.
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';
import { user } from './session.ts';

export function PrivacyPage() {
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => { api.privacy().then((r) => setDays(r.reportDays), () => {}); }, []);
  const me = user.value;
  return (
    <div class="page privacy-page">
      <h1 class="page-title">Privacy</h1>
      <p class="lede">Folly Studio keeps what it needs to save your looks and keep the site running, and nothing to
        follow you around the web. No ads, no trackers, no email.</p>
      <section class="models-panel privacy-part" aria-labelledby="p-kept">
        <h2 id="p-kept">What is stored</h2>
        <dl>
          <dt>Your account</dt>
          <dd>Your username, a salted hash of your password (never the password itself), your role, when you joined
            and how far you got in the tutorial. No email or real name. Usernames show in the gallery.</dd>
          <dt>Your looks</dt>
          <dd>Every look you save, with its versions, bakes and previews. Looks you share show in the gallery.</dd>
          <dt>Visits</dt>
          <dd>Visitors are counted with a hash of the address and browser, under a salt made each day and never
            written down, so one day's visits cannot be linked to the next. No address is stored. The server's log
            notes each request's page and, behind our tunnel, the country it came from.</dd>
          <dt>Bug reports</dt>
          <dd>When you report a problem (F8) or a look, the report keeps your note, your username, a screenshot if you
            leave it on, the page's state (such as your unsaved look and its error messages) and the server's last
            warning lines. Secrets and addresses are scrubbed from the page's state and the log lines, but not from
            your note or the screenshot, so leave passwords and personal details out of those. Only admins read
            reports, and each is deleted after {days ?? 'a set number of'} days.</dd>
        </dl>
      </section>
      <section class="models-panel privacy-part" aria-labelledby="p-cookies">
        <h2 id="p-cookies">Cookies and storage</h2>
        <p>One cookie, <code>studio_session</code>, keeps you signed in: 30 days, or 7 for a guest. Nothing tracks
          you. Your browser keeps a guest's work, your place in the tutorial and your view settings in its own
          storage; clearing this site's data removes them.</p>
      </section>
      <section class="models-panel privacy-part" aria-labelledby="p-delete">
        <h2 id="p-delete">Deleting your data</h2>
        <p>On <a href="/account">Account</a>, Delete account removes your account, its sessions and every look you
          made at once; shared looks leave the gallery. Copies others saved are theirs. A guest's work goes when
          you clear this site's data. Bug reports expire on their own as above.</p>
      </section>
      {!me && <p class="privacy-back"><a class="btn ghost" href="/login">Back to sign in</a></p>}
    </div>);
}
