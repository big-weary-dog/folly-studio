// /live: the shared stage, full bleed: the 3D view of what plays, its title, who is controlling, the sync, and for
// controllers a way to the controller. Nothing here edits; pattern code runs only in this page's sandbox.
import '../../../css/studio.css';
import '../../../css/live.css';

import { useEffect, useRef } from 'preact/hooks';

import { Rose } from '../rose.tsx';
import { cx } from '../kit.tsx';
import { setTitle } from '../session.ts';
import { liveSocket } from './socket.ts';
import { createStage } from './stage.ts';

export function LivePage() {
  const ref = useRef<{ sock: ReturnType<typeof liveSocket>, stage: ReturnType<typeof createStage> } | null>(null);
  ref.current ??= (() => { const sock = liveSocket(); return { sock, stage: createStage(sock) }; })();
  const { sock, stage } = ref.current;
  const canvas = useRef<HTMLCanvasElement>(null), host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stage.start(canvas.current!, host.current!);
    return () => { stage.destroy(); sock.close(); };
  }, []);
  void sock.rev.value;
  const live = sock.live, look = live?.look, msg = stage.msg.value, who = sock.presence.value;
  useEffect(() => { setTitle(look ? `Live: ${look.title}` : 'Live'); }, [look?.title]);
  const driving = who.controllers.length ? who.controllers.join(', ') : live?.by?.username;
  return (
    <section class="live-page" aria-label="Live stage">
      <div class="viewer live-viewer">
        <canvas class="viewer-canvas" ref={canvas} tabindex={0} aria-label="The live stage in 3D. Drag to orbit." />
        <div class={cx('viewer-msg', msg?.error && 'error')} role="status" hidden={!msg}>
          {msg && !msg.error && <Rose detail="full" class="rose-loader" />}{msg?.text}</div>
        <div class="live-bar">
          <span class={cx('live-dot', sock.status.value)} title={`Connection: ${sock.status.value}`} />
          <span class="live-title">{look ? look.title : 'Live'}</span>
          {look?.ownerName && <span class="live-sub">by {look.ownerName}</span>}
          {stage.blackout.value && <span class="tag tag-ruby">Blackout</span>}
          <span class="live-spacer" />
          {driving && <span class="live-sub">controlled by {driving}</span>}
          <span class="live-sub live-count">{who.viewers} watching</span>
          <span class="live-stats" aria-hidden="true">{stage.stats}</span>
          {sock.control.value && <a class="btn small" href="/live/control">Control</a>}
        </div>
      </div>
      <div ref={host} class="sandbox-host" aria-hidden="true" />
    </section>);
}
