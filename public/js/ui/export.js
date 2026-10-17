// Export: an xLights/FPP .fseq rendered in the sandbox, or the look as JSON.
import { h, nextId, openDialog, download, slugify, toast } from './dom.js';

const FPS = 40;

/** Squeeze full frames down to the ranged channels, in place (each frame moves left). */
export function packFrames(channels, frames, frameSize, ranges) {
  let to = 0;
  for (let f = 0; f < frames; f++) {
    const base = f * frameSize;
    for (const [start, count] of ranges) {
      channels.copyWithin(to, base + start, base + start + count);
      to += count;
    }
  }
  return channels.subarray(0, to);
}

/** exportFseqDialog({ runtime, cathedral, title, duration (the default length, s) }) */
export async function exportFseqDialog({ runtime, cathedral, title, duration = 30 }) {
  const { ledRanges, writeFseq } = await import('../fseq.js');
  const channelCount = (cathedral.universes || 80) * (cathedral.channelsPerUniverse || 510);
  const ranges = ledRanges(cathedral);
  const usedCount = ranges.reduce((n, r) => n + r[1], 0);
  let running = false;

  return openDialog({
    title: 'Export .fseq',
    className: 'export-dialog',
    onClose: () => { if (running) { running = false; runtime.cancelRender(); } },
    build(close) {
      const slider = (label, min, max, step, value) => {
        const id = nextId('ex');
        const input = h('input', { type: 'range', id, min, max, step, value });
        const out = h('output', { for: id });
        return { input, out, field: h('div', { class: 'field slider-field' }, h('label', { for: id, text: label }),
          input, out) };
      };
      // Defaults to the look's duration. Up to 2 minutes: the sandbox hands back full frames.
      const dur = slider('Duration', 1, 120, 0.25, Math.min(120, Math.max(1, duration)));
      const gamma = slider('Gamma', 1, 3, 0.1, 1), bright = slider('Brightness', 5, 100, 1, 100);
      const inputs = [dur.input, gamma.input, bright.input];
      const info = h('p', { class: 'export-info' });
      const bar = h('progress', { max: 1, value: 0, class: 'export-progress', hidden: true,
        'aria-label': 'Export progress' });
      const status = h('p', { class: 'export-status', role: 'status', 'aria-live': 'polite' });
      const go = h('button', { type: 'button', class: 'btn primary', text: 'Render & download' });
      const cancel = h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onClick: () => close(false) });

      const sync = () => {
        const secs = +dur.input.value;
        dur.out.textContent = `${secs} s`;
        gamma.out.textContent = (+gamma.input.value).toFixed(1);
        bright.out.textContent = `${bright.input.value}%`;
        const frames = Math.round(secs * FPS);
        const mb = (frames * usedCount) / 1e6;
        info.textContent = `${frames.toLocaleString()} frames at ${FPS} fps · the ${usedCount.toLocaleString()} `
          + `channels the LEDs use, in ${ranges.length} sparse ranges of the ${channelCount.toLocaleString()}-channel `
          + `layout · about ${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB, uncompressed FSEQ v2.`;
      };
      for (const el of inputs) el.addEventListener('input', sync);
      sync();

      go.addEventListener('click', async () => {
        running = true;
        go.disabled = true;
        for (const el of inputs) el.disabled = true;
        const frames = Math.round(+dur.input.value * FPS);
        Object.assign(bar, { hidden: false, max: frames, value: 0 });
        status.textContent = 'Rendering…';
        const t0 = performance.now();
        try {
          const channels = await runtime.render({
            start: 0, frames, fps: FPS, gamma: +gamma.input.value, brightness: +bright.input.value / 100,
            onProgress: (done) => {
              bar.value = done;
              const pct = Math.round((done / frames) * 100);
              const eta = done > 0 ? ((performance.now() - t0) / 1000 / done) * (frames - done) : 0;
              const left = eta > 1 ? `, about ${Math.ceil(eta)} s left` : '';
              status.textContent = `Rendering… ${pct}% (${done.toLocaleString()} / ${frames.toLocaleString()} `
                + `frames${left})`;
            },
          });
          status.textContent = 'Writing the file…';
          const realFrames = Math.floor(channels.length / channelCount) || frames;
          const data = packFrames(channels, realFrames, channelCount, ranges);
          const bytes = writeFseq({ frames: realFrames, stepMs: 1000 / FPS, data, ranges });
          download(bytes, `${slugify(title, 'folly-look')}.fseq`);
          const size = `${(bytes.length / 1e6).toFixed(1)} MB`;
          toast(`Exported ${realFrames.toLocaleString()} frames (${size}).`, { kind: 'ok' });
          running = false;
          close(true);
        } catch (err) {
          running = false;
          status.textContent = err.message || String(err);
          status.classList.add('form-error');
          go.disabled = false;
          for (const el of inputs) el.disabled = false;
        }
      });

      const hint = '1.0 sends values as previewed. Use about 2.2 when the controller (FPP / the F48s) applies no '
        + 'gamma of its own, so the LEDs look like the screen.';
      return [h('div', { class: 'export-fields' }, dur.field, gamma.field, h('p', { class: 'field-hint', text: hint }),
        bright.field), info, bar, status, h('div', { class: 'dialog-actions' }, cancel, go)];
    },
  });
}

export function exportLookJson({ title, summary, layers, duration, bpm }) {
  const data = JSON.stringify({ title, summary, duration, ...(bpm ? { bpm } : {}), layers }, null, 2) + '\n';
  download(data, `${slugify(title, 'folly-look')}.json`, 'application/json');
}
