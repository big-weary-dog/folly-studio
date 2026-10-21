// /live: the shared stage, full bleed: the 3D view of what plays, its title, who is controlling, the sync (for admins
// or with ?stats), and for controllers a way to the controller. On the Pi, curators get the live play page instead
// (pi/page/controller.tsx, SPEC-liveplay "The page"), with this stage as its aside. Pattern code runs only in this
// page's sandbox.
import '../../../css/studio.css';
import '../../../css/live.css';
import '../../../css/liveplay.css';

import { useEffect, useRef } from 'preact/hooks';

import { STOP_ON_SITE } from '../../../../pi/page/app.tsx';
import { Controller } from '../../../../pi/page/controller.tsx';
import { piSocket } from '../../../../pi/page/socket.ts';
import { can } from '../../../../shared/policy.ts';
import { reportPage } from '../bug-report.tsx';
import { Rose } from '../rose.tsx';
import { cx } from '../kit.tsx';
import { onPi, setTitle, user } from '../session.ts';
import { studioSources } from './lights.ts';
import { liveSocket, troubleText } from './socket.ts';
import { createStage } from './stage.ts';

const STOP_ON_SITE_STUDIO = `On site: the Pi's own page (/pi/), or ${STOP_ON_SITE.slice('On site: '.length)}`;

export function LivePage() {
  const ref = useRef<{ sock: ReturnType<typeof liveSocket>, stage: ReturnType<typeof createStage>,
    lights: ReturnType<typeof piSocket> | null, sources: ReturnType<typeof studioSources> } | null>(null);
  ref.current ??= (() => {
    const sock = liveSocket();
    // The live play page: curators on the Pi, over the engine's socket behind Studio's /pi.
    const lights = onPi() && can(user.value, 'curate') ? piSocket('/pi/ws') : null;
    return { sock, stage: createStage(sock), lights, sources: lights ? studioSources(lights) : [] };
  })();
  const { sock, stage, lights, sources } = ref.current;
  const canvas = useRef<HTMLCanvasElement>(null), host = useRef<HTMLDivElement>(null);
  // Held still by a bug report, by another view, or both: each lets go only of its own.
  const still = useRef({ report: false, hidden: false });
  const hold = () => stage.freeze(still.current.report || still.current.hidden);
  useEffect(() => {
    stage.start(canvas.current!, host.current!);
    // Its part in a bug report (SPEC "Bug reports"): the stage as this page has it; paused, updates are held.
    const unreport = reportPage('live', {
      read: () => {
        const l = sock.live;
        return { rev: sock.rev.peek(), status: sock.status.peek(), driver: l?.driver, control: sock.control.peek(),
          look: l?.look && { id: l.look.id, title: l.look.title }, blackout: stage.blackout.peek(), t: stage.t.peek(),
          presence: sock.presence.peek(), clock: sock.clock.peek(), stats: stage.stats.peek() };
      },
      freeze: (on) => { sock.hold(on); still.current.report = on; hold(); },
      shot: () => stage.viewer?.snapshot() ?? null,
    });
    return () => { unreport(); stage.destroy(); sock.close(); lights?.close(); };
  }, []);
  // The 3D view sleeps while the live play page hides it (a phone, with its menu closed).
  const shown = (on: boolean) => { still.current.hidden = !on; hold(); };
  void sock.rev.value;
  // Can't reach the stage, or it is full: said over whatever the stage last showed.
  const trouble = troubleText(sock.trouble.value);
  const msg = trouble ? { text: trouble, error: true } : stage.msg.value;
  const live = sock.live, who = sock.presence.value, fromPi = live?.driver === 'pi';
  // While /pi drives, its look (the Pi's own, so no owner) stands in for the stage's.
  const pi = fromPi ? sock.pi.value?.source : null, look = fromPi ? pi : live?.look;
  const next = fromPi ? sock.pi.value?.now?.queue?.[0] : null;
  useEffect(() => { setTitle(look ? `Live: ${look.title}` : 'Live'); }, [look?.title]);
  const driving = fromPi ? null : who.controllers.length ? who.controllers.join(', ') : live?.by?.username;
  const viewer = (
    <div class={cx('viewer live-viewer', lights && 'aside')}>
      <canvas class="viewer-canvas" ref={canvas} tabindex={0} aria-label="The live stage in 3D. Drag to orbit." />
      <div class={cx('viewer-msg', msg?.error && 'error')} role="status" hidden={!msg}>
        {msg && !msg.error && <Rose detail="full" class="rose-loader" />}{msg?.text}</div>
      {!lights && <div class="live-bar">
        <span class={cx('live-dot', sock.status.value)} title={`Connection: ${sock.status.value}`} />
        <span class="live-title">{look ? look.title : 'Live'}</span>
        {live?.look && !fromPi && live.look.ownerName && <span class="live-sub">by {live.look.ownerName}</span>}
        {pi?.baked && <span class="tag tag-sapphire">Baked: on the lights only</span>}
        {next && <span class="live-sub live-next">Up next: {next.title}</span>}
        {!fromPi && stage.blackout.value && <span class="tag tag-ruby">Blackout</span>}
        <span class="live-spacer" />
        {live && <span class="live-sub live-driver">driven from {fromPi ? '/pi' : 'Live control'}</span>}
        {driving && <span class="live-sub">controlled by {driving}</span>}
        <span class="live-sub live-count">{who.viewers} watching</span>
        {(can(user.value, 'admin') || new URLSearchParams(location.search).has('stats'))
          && <span class="live-stats" aria-hidden="true">{stage.stats}</span>}
        {sock.control.value && <a class="btn small" href="/live/control">Control</a>}
      </div>}
    </div>);
  return (
    <section class={cx('live-page', lights && 'lights')} aria-label="Live stage">
      {lights ? <Controller sock={lights} sources={sources} title="The lights" stop={STOP_ON_SITE_STUDIO}
        aside={{ label: 'The Folly in 3D', node: viewer, onShown: shown }} /> : viewer}
      <div ref={host} class="sandbox-host" aria-hidden="true" />
    </section>);
}
