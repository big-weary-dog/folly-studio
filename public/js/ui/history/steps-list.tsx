// The Steps tab: this session's steps, oldest first (steps.ts). A click jumps there and greys the later steps until
// a new edit drops them; a save marks its step; an AI round shows what it was asked and what it changed.
import { useLayoutEffect, useRef } from 'preact/hooks';

import { cx } from '../kit.tsx';
import { user } from '../session.ts';
import type { Studio } from '../studio-store.ts';
import type { Kind } from './steps.ts';

const ICON: Record<Kind, string> = { open: '◷', add: '+', remove: '−', set: '~', move: '⇅', code: '✎', ai: '✦',
  restore: '↺' };
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function StepsList({ st }: { st: Studio }) {
  const list = useRef<HTMLOListElement>(null), steps = st.history.list.value, now = st.history.at.value;
  const ahead = steps.length - 1 - now, admin = user.value?.role === 'admin';
  useLayoutEffect(() => { list.current?.querySelector('.is-now')?.scrollIntoView({ block: 'nearest' }); }, [now]);
  return <>
    <ol class="history-steps" ref={list} aria-label="Steps, oldest first">
      {steps.map((s, i) => <li class={cx('hstep', `k-${s.kind}`, s.saved && 'k-saved', i === now && 'is-now',
        i > now && 'is-ahead')}>
        <button type="button" class="hstep-btn" aria-current={i === now ? 'step' : undefined}
          title={i === now ? 'Where you are' : `Go back to here (${clock(s.at)})`} onClick={() => st.jump(i)}>
          <span class="hstep-icon" aria-hidden="true">{ICON[s.kind]}</span>
          <span class="hstep-text"><span class="hstep-label">{s.label}</span>
            {(s.where || s.saved) && <span class="hstep-sub">{[s.where, s.saved && 'Saved'].filter(Boolean)
              .join(' · ')}</span>}</span>
          <span class="hstep-time">{clock(s.at)}</span></button>
        {s.ai && <details class="hstep-ai" open={i === now || undefined}>
          <summary>{`“${s.ai.asked}”${s.ai.by ? ` · ${s.ai.by}` : ''}`}</summary>
          <ul>{s.ai.changes.map((c) => <li>{c}</li>)}</ul>
          {admin && <a href={`/api/admin/ideas/${encodeURIComponent(s.ai.ideaId)}/log`} target="_blank"
            rel="noopener">How it was made: the idea's log →</a>}
        </details>}
      </li>)}</ol>
    {ahead > 0 ? <p class="history-hint" role="status">{`You went back ${ahead} step${ahead > 1 ? 's' : ''}. The look `
      + 'plays as it was here. A new edit drops the greyed steps; Redo brings them back.'}</p>
      : <p class="history-hint">This session only. Ctrl+Z undoes, Ctrl+Shift+Z redoes. Saving keeps a version
        (Versions); the steps start again next time you open the look.</p>}</>;
}
