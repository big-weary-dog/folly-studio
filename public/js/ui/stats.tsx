// The Stats page, for admins (SPEC-access "Stats"): today's visits and requests, the last days', the slowest
// requests, the work done in the last day, and the server's memory and load; counted since the server started.
import '../../css/pages.css';

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';
import type { ServerStats, StatsDay } from '../../../shared/schemas/api.ts';
import { timeAgo } from './kit.tsx';
import { setTitle } from './session.ts';
import { usePhone } from './phone/viewport.ts';

const COLUMNS: [keyof StatsDay, string][] = [['visitors', 'Visitors'], ['people', 'Signed in'], ['views', 'Pages'],
  ['requests', 'Requests'], ['errors', 'Errors'], ['slow', 'Slow']];
const mb = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MB`;
const took = (s: number) => (s < 3600 ? `${Math.floor(s / 60)} min`
  : s < 86_400 ? `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min` : `${Math.floor(s / 86_400)} days`);

export function StatsPage() {
  const phone = usePhone();
  const [stats, setStats] = useState<ServerStats | null>(null), [error, setError] = useState('');
  const load = () => api.stats().then((s) => { setStats(s); setError(''); }, (e) => setError(e.message));
  useEffect(() => { setTitle('Stats'); void load(); }, []);
  const today = stats?.days[0];
  return (
    <div class="page stats-page">
      <h1 class="page-title">Stats</h1>
      <p class="lede laptop-only">Who came and how the server is doing, counted since it started:
        a restart starts again.
        A visitor is a browser at an address, told apart each day without keeping either.</p>
      <p class={error ? 'form-error' : 'pane-hint'} role={error ? 'alert' : undefined} hidden={!!stats && !error}>
        {error || 'Loading…'}</p>
      {stats && <>
        {!phone && <dl class="stats-tiles" aria-label="Today">
          {COLUMNS.map(([key, text]) => <div key={key} class="stats-tile"><dt>{text}</dt>
            <dd>{today?.[key] ?? 0}</dd></div>)}
        </dl>}
        <section class="models-panel" aria-label="The server">
          <p class="field-hint">Up {took(stats.uptime)}, since {new Date(stats.startedAt).toLocaleString()}.
            Memory {mb(stats.memory.rss)} ({mb(stats.memory.heap)} in use by scripts); load {stats.load.toFixed(2)}.
          </p>
          <p class="field-hint">In the last day: {stats.bakes.done} bakes, {stats.bakes.failed} failed
            {stats.ideas && <>; {stats.ideas.made} ideas, {stats.ideas.failed} failed</>}.
            Waiting now: {stats.bakes.waiting} bakes{stats.ideas && <>, {stats.ideas.waiting} ideas</>}.</p>
        </section>
        {!phone && <><div class="stats-scroll"><table class="stats-table">
          <caption>Each day (the server's time zone)</caption>
          <thead><tr><th scope="col">Day</th>{COLUMNS.map(([key, text]) => <th key={key} scope="col">{text}</th>)}
          </tr></thead>
          <tbody>{stats.days.map((d) => <tr key={d.day}><th scope="row">{d.day}</th>
            {COLUMNS.map(([key]) => <td key={key}>{d[key]}</td>)}</tr>)}</tbody>
        </table></div>
        <h2 class="stats-head">Slowest requests</h2>
        {!stats.slowest.length ? <p class="pane-hint">None took a second or more.</p>
          : <ul class="stats-slow">{stats.slowest.map((r) => <li key={r.at + r.route}>
            <code>{r.method} {r.route}</code> {r.status}, {(r.ms / 1000).toFixed(1)} s,{' '}
            <time dateTime={r.at} title={new Date(r.at).toLocaleString()}>{timeAgo(r.at)}</time></li>)}</ul>}</>}
      </>}
      <div class="models-actions"><button type="button" class="btn small ghost" onClick={() => void load()}>
        Refresh</button></div>
    </div>);
}
