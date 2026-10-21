// /live: the shared stage, full bleed: the 3D view of what plays, its title, who is controlling, the sync (for admins
// or with ?stats), and for controllers a way to the controller. On the Pi, curators get the jukebox (jukebox.tsx):
// the Folly, the track listing and the lights' controls. Pattern code runs only in this page's sandbox.
import '../../../css/studio.css';
import '../../../css/live.css';

import { useEffect, useRef } from 'preact/hooks';

import { piSocket } from '../../../../pi/page/socket.ts';
import { can } from '../../../../shared/policy.ts';
import { reportPage } from '../bug-report.tsx';
import { Rose } from '../rose.tsx';
import { cx } from '../kit.tsx';
import { onPi, setTitle, user } from '../session.ts';
import { JukeboxBar, JukeboxPanel, useView, ViewSwitch } from './jukebox.tsx';
import { liveSocket, troubleText } from './socket.ts';
import { createStage } from './stage.ts';

export function LivePage() {
  const ref = useRef<{ sock: ReturnType<typeof liveSocket>, stage: ReturnType<typeof createStage>,
    lights: ReturnType<typeof piSocket> | null } | null>(null);
  ref.current ??= (() => {
    const sock = liveSocket();
    // The jukebox: curators on the Pi, over the engine's socket behind Studio's /pi.
    const lights = onPi() && can(user.value, 'curate') ? piSocket('/pi/ws') : null;
    return { sock, stage: createStage(sock), lights };
  })();
  const { sock, stage, lights } = ref.current;
  const [view, setView] = useView(), shown = lights ? view : 'folly';
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
  // The 3D view sleeps while the listing or the controls are shown.
  useEffect(() => { still.current.hidden = shown !== 'folly'; hold(); }, [shown]);
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
  return (
    <section class="live-page" aria-label="Live stage">
      {lights && <ViewSwitch view={shown} set={setView} />}
      {lights && shown !== 'folly' && <div class="live-panel"><JukeboxPanel sock={lights} view={shown} /></div>}
      <div class={cx('viewer live-viewer', shown !== 'folly' && 'off')}>
        <canvas class="viewer-canvas" ref={canvas} tabindex={0} aria-label="The live stage in 3D. Drag to orbit." />
        <div class={cx('viewer-msg', msg?.error && 'error')} role="status" hidden={!msg}>
          {msg && !msg.error && <Rose detail="full" class="rose-loader" />}{msg?.text}</div>
        <div class="live-bar">
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
          {lights ? <JukeboxBar sock={lights} />
            : sock.control.value && <a class="btn small" href="/live/control">Control</a>}
        </div>
      </div>
      <div ref={host} class="sandbox-host" aria-hidden="true" />
    </section>);
}
