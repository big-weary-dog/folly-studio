// The Reports page, for admins: the F8 bug reports people filed (SPEC "Bug reports"), newest first; one opens to its
// note, screenshot, server log lines and the whole report, and "Open as captured" replays its Studio moment.
import '../../css/reports.css';

import { useEffect, useState } from 'preact/hooks';

import type { ReportSummary } from '../../../shared/schemas/report.ts';
import { api } from '../api.ts';
import { cx, timeAgo } from './kit.tsx';
import { setTitle, type ViewProps } from './session.ts';

type Full = Awaited<ReturnType<typeof api.bugReport>>['report'];
const shotUrl = (id: string) => `/api/admin/reports/${encodeURIComponent(id)}/shot`;

export function ReportsPage({ query }: ViewProps) {
  const [list, setList] = useState<ReportSummary[] | null>(null), [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(query.get('id'));
  useEffect(() => {
    setTitle('Reports');
    api.reports().then((r) => setList(r.reports), (err) => setError((err as Error).message));
  }, []);
  return (
    <div class="page reports-page">
      <h1 class="page-title">Reports</h1>
      <p class="lede">What people sent with F8 (or "Report a problem"). Workers read them with
        <code> node tools/reports.ts list</code>.</p>
      {!list ? <p class={error ? 'form-error' : 'pane-hint'}>{error || 'Loading…'}</p>
        : !list.length ? <p class="pane-hint">No reports yet.</p>
        : <ul class="report-list">{list.map((r) => <li key={r.id} class={cx('report-row', open === r.id && 'open')}>
          <button type="button" class="report-head" aria-expanded={open === r.id}
            onClick={() => setOpen(open === r.id ? null : r.id)}>
            {r.shot ? <img class="report-row-shot" src={shotUrl(r.id)} alt="" loading="lazy" />
              : <span class="report-row-shot none" aria-hidden="true" />}
            <span class="report-row-text">
              <span class="report-row-note">{r.note || '(no note)'}</span>
              <span class="report-row-meta">
                <time dateTime={r.at} title={new Date(r.at).toLocaleString()}>{timeAgo(r.at)}</time>
                {' · '}{r.user || '?'}{r.look && ` · ${r.look}`} · <code>{r.path}</code></span>
            </span>
          </button>
          {open === r.id && <ReportDetail id={r.id} />}
        </li>)}</ul>}
    </div>);
}

function ReportDetail({ id }: { id: string }) {
  const [r, setR] = useState<Full | null>(null), [error, setError] = useState('');
  useEffect(() => { api.bugReport(id).then((x) => setR(x.report), (err) => setError((err as Error).message)); }, [id]);
  if (!r) return <p class={error ? 'form-error' : 'pane-hint'}>{error || 'Loading…'}</p>;
  const server = r.server as { build?: string; logs?: { at: string; level: string; text: string }[] } | undefined;
  const studio = (r.sources as { studio?: { clock?: { t?: number } } } | undefined)?.studio;
  return (
    <div class="report-detail">
      <p class="report-note-full">{r.note || '(no note)'}</p>
      <div class="report-actions">
        {studio && <a class="btn small primary" href={`/studio?report=${encodeURIComponent(id)}`}>
          Open as captured{studio.clock?.t !== undefined ? ` (${studio.clock.t.toFixed(2)} s)` : ''}</a>}
        {r.shot && <a class="btn small ghost" href={shotUrl(id)} target="_blank" rel="noopener">Screenshot</a>}
        <span class="report-build">page {r.build || '?'} · server {server?.build || '?'} · id <code>{id}</code></span>
      </div>
      {r.shot && <img class="report-detail-shot" src={shotUrl(id)} alt="The view when the report was filed" />}
      {!!server?.logs?.length && <details><summary>Server warnings ({server.logs.length})</summary>
        <pre class="report-pre">{server.logs.map((l) => `${l.at} ${l.level} ${l.text}`).join('\n')}</pre></details>}
      <details><summary>The whole report</summary>
        <pre class="report-pre">{JSON.stringify(r, null, 1)}</pre></details>
    </div>);
}
