// Exports and details, loaded on first use: the look as JSON, an xLights/FPP .fseq rendered in the sandbox, and the
// look's title and summary.
import { useState } from 'preact/hooks';

import { correctionOf } from '../core/output.ts';
import type { Runtime } from '../runtime.ts';
import { confirmDialog, download, Field, openDialog, pref, Scrub, slugify, toast } from './kit.tsx';
import type { Preview } from './preview.ts';
import type { Studio } from './studio-store.ts';

const FPS = 40;
// The LEDs' correction this browser last exported with; core/output.ts's OUTPUT_CORRECTION until then.
const savedCorrection = () => {
  try { return correctionOf(JSON.parse(pref('studio.output') || 'null')); } catch { return correctionOf(); }
};

export function exportJson(st: Studio) {
  st.flush();
  const { title, summary, layers, duration, bpm, globals, automation } = st.body.peek();
  const data = JSON.stringify({ title, summary, duration, ...(bpm ? { bpm } : {}), ...(globals ? { globals } : {}),
    ...(automation ? { automation } : {}), layers }, null, 2) + '\n';
  download(data, `${slugify(title, 'folly-look')}.json`, 'application/json');
}

export function details(st: Studio) {
  const L = st.look.peek();
  openDialog({ title: 'Look details', body: (close) => {
    const [title, setTitle] = useState(L.title), [summary, setSummary] = useState(L.summary || '');
    return (
      <form class="details-form" onSubmit={(e) => {
        e.preventDefault();
        st.edit(() => ({ title: title.trim() || 'Untitled look', summary: summary.trim() }));
        close(true);
      }}>
        <Field label="Title">{(id) => <input id={id} type="text" maxlength={120} value={title}
          onInput={(e) => setTitle(e.currentTarget.value)} />}</Field>
        <Field label="Summary" stack>{(id) => <textarea id={id} rows={4} maxlength={600} value={summary}
          onInput={(e) => setSummary(e.currentTarget.value)} />}</Field>
        {L.ideaId && <p class="field-hint">Generated from one of your ideas.</p>}
        <div class="dialog-actions">
          <button type="button" class="btn ghost" onClick={() => close(false)}>Cancel</button>
          <button type="submit" class="btn primary">Done</button></div>
      </form>);
  } });
}

export async function exportFseq(st: Studio, pv: Preview) {
  const runtime = pv.runtime;
  if (!runtime?.ready) return toast('The pattern engine is still starting.', { kind: 'warn' });
  st.flush();
  const paused = st.look.peek().layers.filter((l) => st.status.of(l.id).kind === 'hung');
  if (paused.length) {
    const many = paused.length > 1, names = paused.map((l) => `“${l.title}”`).join(', ');
    const why = `${names} ${many ? 'are' : 'is'} paused because ${many ? 'they' : 'it'} hung, so the export would `
      + `leave ${many ? 'them' : 'it'} out. Export the rest anyway?`;
    if (!(await confirmDialog(why, { title: 'A layer is paused', ok: 'Export anyway' }))) return undefined;
  }
  const { ledRanges, writeFseq } = await import('../fseq.ts');
  const rig = st.data.rig as NonNullable<typeof st.data.rig>, L = st.look.peek();
  const channelCount = rig.output.universes * rig.output.channelsPerUniverse;
  const ranges = ledRanges(rig), used = ranges.reduce((n, r) => n + r[1], 0);
  let running = false;
  await openDialog({ title: 'Export .fseq', className: 'export-dialog',
    onClose: () => { if (running) { running = false; runtime.cancelRender(); } },
    body: (close) => <FseqForm close={close} runtime={runtime} title={L.title.trim() || 'folly-look'}
      channelCount={channelCount} ranges={ranges} used={used} duration={L.duration} running={(on) => { running = on; }}
      write={(frames, data) => writeFseq({ frames, stepMs: 1000 / FPS, data, ranges })} /> });
  // An export can find a layer that hangs: show where things stand now, even when paused.
  runtime.refresh();
  pv.kick();
  return undefined;
}

/** Squeeze full frames down to the ranged channels, in place (each frame moves left). */
function packFrames(channels: Uint8Array, frames: number, frameSize: number, ranges: [number, number][]) {
  let to = 0;
  for (let f = 0; f < frames; f++) {
    const base = f * frameSize;
    for (const [start, count] of ranges) { channels.copyWithin(to, base + start, base + start + count); to += count; }
  }
  return channels.subarray(0, to);
}

const Num = ({ label, ...props }: Parameters<typeof Scrub>[0] & { label: string }) =>
  <Field label={label} class="end">{(id) => <Scrub id={id} {...props} />}</Field>;

function FseqForm({ close, runtime, title, channelCount, ranges, used, duration, running, write }: {
  close: (v?: boolean) => void; runtime: Runtime; title: string; channelCount: number; ranges: [number, number][];
  used: number; duration: number; running: (on: boolean) => void;
  write: (frames: number, data: Uint8Array) => Uint8Array }) {
  // Defaults to the look's duration. Up to 2 minutes: the sandbox hands back full frames.
  const [secs, setSecs] = useState(Math.min(120, Math.max(1, duration))), [fix, setFix] = useState(savedCorrection);
  const [bright, setBright] = useState(100), [done, setDone] = useState(-1), [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false), busy = done >= 0 && !failed;
  const frames = Math.round(secs * FPS), size = (frames * used) / 1e6;
  async function go() {
    pref('studio.output', JSON.stringify(fix));
    running(true);
    setFailed(false);
    setDone(0);
    setStatus('Rendering…');
    const t0 = performance.now();
    try {
      const channels = await runtime.render({ start: 0, frames, fps: FPS, correction: fix, brightness: bright / 100,
        onProgress: (n: number) => {
          setDone(n);
          const eta = n > 0 ? ((performance.now() - t0) / 1000 / n) * (frames - n) : 0;
          setStatus(`Rendering… ${Math.round((n / frames) * 100)}% (${n.toLocaleString()} / `
            + `${frames.toLocaleString()} frames${eta > 1 ? `, about ${Math.ceil(eta)} s left` : ''})`);
        } });
      setStatus('Writing the file…');
      const real = Math.floor(channels.length / channelCount) || frames;
      const bytes = write(real, packFrames(channels, real, channelCount, ranges));
      download(bytes as BlobPart, `${slugify(title, 'folly-look')}.fseq`);
      toast(`Exported ${real.toLocaleString()} frames (${(bytes.length / 1e6).toFixed(1)} MB).`, { kind: 'ok' });
      running(false);
      close(true);
    } catch (err) {
      running(false);
      setFailed(true);
      setStatus((err as Error).message || String(err));
    }
  }
  return <>
    <div class="export-fields">
      <Num label="Duration" min={1} max={120} step={0.25} unit=" s" value={secs} set={setSecs} disabled={busy} />
      <Num label="LED gamma" min={1} max={3} step={0.05} value={fix.gamma} disabled={busy}
        set={(gamma) => setFix({ ...fix, gamma })} />
      {['Red', 'Green', 'Blue'].map((name, i) => <Num label={`${name} balance`} min={0} max={100} step={1} unit="%"
        value={Math.round(fix.balance[i] * 100)} disabled={busy}
        set={(v) => setFix({ ...fix, balance: fix.balance.map((b, j) => (j === i ? v / 100 : b)) })} />)}
      <p class="field-hint">So the LEDs look like the screen: 2.2 for controllers that apply no gamma of their own (the
        F48s are set to None), 1.0 sends values as previewed. Balance trims a colour down to even out the whites.</p>
      <Num label="Brightness" min={5} max={100} step={1} unit="%" value={bright} set={setBright} disabled={busy} />
    </div>
    <p class="export-info">{`${frames.toLocaleString()} frames at ${FPS} fps · the ${used.toLocaleString()} channels `
      + `the LEDs use, in ${ranges.length} sparse ranges of the ${channelCount.toLocaleString()}-channel layout · `
      + `about ${size < 10 ? size.toFixed(1) : size.toFixed(0)} MB, uncompressed FSEQ v2.`}</p>
    <progress class="export-progress" max={frames} value={Math.max(0, done)} hidden={done < 0}
      aria-label="Export progress" />
    <p class={failed ? 'export-status form-error' : 'export-status'} role="status" aria-live="polite">{status}</p>
    <div class="dialog-actions">
      <button type="button" class="btn ghost" onClick={() => close(false)}>Cancel</button>
      <button type="button" class="btn primary" disabled={busy} onClick={go}>Render & download</button></div>
  </>;
}
