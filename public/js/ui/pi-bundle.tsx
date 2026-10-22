// The Pi bundle page (SPEC-offline "Downloading the Pi bundle"): this server's bundle of the commit it runs, to
// download here or with a curl line whose link lasts an hour. For curators and admins; the server checks.
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import { api, statusOf } from '../api.ts';
import { timeAgo, toast } from './kit.tsx';
import { setTitle } from './session.ts';

type Bundle = Awaited<ReturnType<typeof api.piBundle>>;
const mb = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MB`;

export function PiBundlePage() {
  const [bundle, setBundle] = useState<Bundle | null>(null), [error, setError] = useState('');
  const [curl, setCurl] = useState<{ line: string, expires: string } | null>(null);
  useEffect(() => {
    setTitle('Pi bundle');
    api.piBundle().then(setBundle, (e) => setError(statusOf(e) === 404
      ? 'This server has no Pi bundle: npm run host makes one when it deploys.' : e.message));
  }, []);
  const mint = async () => {
    try {
      const { path, expires } = await api.piBundleLink();
      const line = `curl -fo folly-studio-pi.tar '${location.origin}${path}'`;
      setCurl({ line, expires });
      await navigator.clipboard?.writeText(line).then(() => toast('Copied the curl line.'), () => {});
    } catch (e) { toast((e as Error).message, { kind: 'error' }); }
  };
  return (
    <div class="page pi-bundle-page">
      <h1 class="page-title">Pi bundle</h1>
      <p class="lede">Everything the USB stick carries to install Studio on the Pi, built from the commit this server
        runs: <code>folly-studio-pi.tgz</code>, <code>install.sh</code> and <code>SETUP.md</code> in one folder.
        Unpack it with <code>tar -xf</code> and follow <code>SETUP.md</code>.</p>
      <p class={error ? 'form-error' : 'pane-hint'} role={error ? 'alert' : undefined} hidden={!!bundle && !error}>
        {error || 'Loading…'}</p>
      {bundle && <>
        <section class="models-panel" aria-label="The bundle">
          <p class="field-hint">Commit <code>{bundle.commit}</code>, {mb(bundle.bytes)}, built{' '}
            <time dateTime={bundle.builtAt} title={new Date(bundle.builtAt).toLocaleString()}>
              {timeAgo(bundle.builtAt)}</time>.</p>
          <div class="models-actions">
            <a class="btn small" href="/api/pi-bundle" download>Download</a>
            <button type="button" class="btn small ghost" onClick={() => void mint()}>Copy curl link</button>
          </div>
        </section>
        {curl && <section class="models-panel" aria-label="Curl">
          <p class="field-hint">For the Pi or any machine without a browser: this link needs no sign-in, so share it
            only with whoever installs. It works until {new Date(curl.expires).toLocaleTimeString()}.</p>
          <input type="text" class="pi-bundle-curl" readOnly value={curl.line} aria-label="The curl line"
            onFocus={(e) => e.currentTarget.select()} />
        </section>}
      </>}
    </div>);
}
