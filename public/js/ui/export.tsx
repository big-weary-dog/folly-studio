// Exports, loaded on first use: the look as JSON and an xLights/FPP .fseq rendered in the sandbox.
import { useState } from 'preact/hooks';

import { api } from '../api.ts';
import { type Light, lightOf } from '../core/light.ts';
import type { Runtime } from '../runtime.ts';
import { confirmDialog, download, Field, openDialog, Scrub, slugify, toast } from './kit.tsx';
import { fileText, lookFile } from './look-file.ts';
import type { Preview } from './preview.ts';
import type { Studio } from './studio-store.ts';

export function exportJson(st: Studio) {
  st.flush();
  const look = st.body.peek();
  download(fileText(lookFile(look, st.server.peek())), `${slugify(look.title, 'folly-look')}.json`, 'application/json');
}

export async function exportFseq(st: Studio, pv: Preview) {
  const runtime = pv.runtime;
  if (!runtime?.ready) return toast('The pattern engine is still starting.', { kind: 'warn' });
  st.flush();
  const excluded = st.look.peek().layers.filter((l) => st.silent(l.id));
  if (excluded.length && !(await confirmDialog(
    `Mute and Solo affect this preview export. It excludes ${excluded.map((l) => `“${l.title}”`).join(', ')}. `
    + 'Save, JSON export and Check & bake include the full look. Export this preview anyway?',
    { title: 'Export the current preview?', ok: 'Export preview' }))) return;
  const paused = st.look.peek().layers.filter((l) => st.status.of(l.id).kind === 'hung');
  if (paused.length) {
    const many = paused.length > 1, names = paused.map((l) => `“${l.title}”`).join(', ');
    const why = `${names} ${many ? 'are' : 'is'} paused because ${many ? 'they' : 'it'} hung, so the export would `
      + `leave ${many ? 'them' : 'it'} out. Export the rest anyway?`;
    if (!(await confirmDialog(why, { title: 'A layer is paused', ok: 'Export anyway' }))) return undefined;
  }
  const { ledRanges, writeFseq } = await import('../fseq.ts');
  const rig = st.data.rig as NonNullable<typeof st.data.rig>, L = st.look.peek();
  const fps = rig.output.fps || 40, channelCount = rig.output.universes * rig.output.channelsPerUniverse;
  const ranges = ledRanges(rig), used = ranges.reduce((n, r) => n + r[1], 0);
  // The light settings (SPEC "Light and output"), the server's: every export goes out on the same curve.
  let light: Light;
  try { light = lightOf(await api.light()); } catch (err) {
    return toast(`The light settings did not load: ${(err as Error).message}`, { kind: 'error' });
  }
  let running = false;
  await openDialog({ title: 'Export .fseq', className: 'export-dialog',
    onClose: () => { if (running) { running = false; runtime.cancelRender(); } },
    body: (close) => <FseqForm fps={fps} close={close} runtime={runtime} light={light}
      title={L.title.trim() || 'folly-look'}
      channelCount={channelCount} ranges={ranges} used={used} duration={L.duration} running={(on) => { running = on; }}
      write={(frames, data) => writeFseq({ frames, stepMs: Math.round(1000 / fps), data, ranges })} /> });
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

function FseqForm({ fps, close, runtime, light, title, channelCount, ranges, used, duration, running, write }: {
  fps: number; close: (v?: boolean) => void; runtime: Runtime; light: Light; title: string; channelCount: number;
  ranges: [number, number][];
  used: number; duration: number; running: (on: boolean) => void;
  write: (frames: number, data: Uint8Array) => Uint8Array }) {
  // Defaults to the look's duration. Up to 2 minutes: the sandbox hands back full frames.
  const [secs, setSecs] = useState(Math.min(120, Math.max(1, duration)));
  const [bright, setBright] = useState(100), [done, setDone] = useState(-1), [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false), busy = done >= 0 && !failed;
  const frames = Math.round(secs * fps), size = (frames * used) / 1e6;
  async function go() {
    running(true);
    setFailed(false);
    setDone(0);
    setStatus('Rendering…');
    const t0 = performance.now();
    try {
      const channels = await runtime.render({ start: 0, frames, fps: fps, light, brightness: bright / 100,
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
    <p class="field-hint">Exports the current preview, including Mute and Solo.
      JSON and Check & bake use the full look.</p>
    <div class="export-fields">
      <Num label="Duration" min={1} max={120} step={0.25} unit=" s" value={secs} set={setSecs} disabled={busy} />
      <Num label="Brightness" min={5} max={100} step={1} unit="%" value={bright} set={setBright} disabled={busy} />
      <p class="field-hint">The LEDs' light, as on the night: the curve set under Admin › Light. Brightness
        scales the light after that, so colours keep their hue.</p>
    </div>
    <p class="export-info">{`${frames.toLocaleString()} frames at ${fps} fps · the ${used.toLocaleString()} channels `
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
