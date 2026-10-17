// Export: an xLights/FPP .fseq rendered in the sandbox, or the look as JSON.
import { h, nextId, openDialog, download, slugify, toast } from './dom.js';

const FPS = 40;

/**
 * @param {object} o
 * @param {import('../runtime.js').Runtime} o.runtime
 * @param {object} o.cathedral
 * @param {string} o.title
 * @param {number} o.duration      default seconds
 */
export function exportFseqDialog({ runtime, cathedral, title, duration = 30 }) {
  const channelCount = (cathedral.universes || 80) * (cathedral.channelsPerUniverse || 510);
  let running = false;

  return openDialog({
    title: 'Export .fseq',
    className: 'export-dialog',
    onClose: () => { if (running) { running = false; runtime.cancelRender(); } },
    build(close) {
      const ids = { d: nextId('ex'), g: nextId('ex'), b: nextId('ex') };
      const dur = h('input', { type: 'range', id: ids.d, min: 5, max: 60, step: 1, value: Math.round(Math.min(60, Math.max(5, duration))) });
      const durOut = h('output', { for: ids.d });
      const gamma = h('input', { type: 'range', id: ids.g, min: 1, max: 3, step: 0.1, value: 1 });
      const gammaOut = h('output', { for: ids.g });
      const bright = h('input', { type: 'range', id: ids.b, min: 5, max: 100, step: 1, value: 100 });
      const brightOut = h('output', { for: ids.b });
      const info = h('p', { class: 'export-info' });
      const bar = h('progress', { max: 1, value: 0, class: 'export-progress', hidden: true, 'aria-label': 'Export progress' });
      const status = h('p', { class: 'export-status', role: 'status', 'aria-live': 'polite' });
      const go = h('button', { type: 'button', class: 'btn primary', text: 'Render & download' });
      const cancel = h('button', { type: 'button', class: 'btn ghost', text: 'Cancel' });

      const sync = () => {
        const secs = +dur.value;
        durOut.textContent = `${secs} s`;
        gammaOut.textContent = (+gamma.value).toFixed(1);
        brightOut.textContent = `${bright.value}%`;
        const frames = secs * FPS;
        const mb = (frames * channelCount) / 1e6;
        info.textContent = `${frames.toLocaleString()} frames at ${FPS} fps · ${channelCount.toLocaleString()} channels (${cathedral.universes || 80} universes × ${cathedral.channelsPerUniverse || 510}) · about ${mb.toFixed(0)} MB, uncompressed FSEQ v2.`;
      };
      for (const el of [dur, gamma, bright]) el.addEventListener('input', sync);
      sync();

      cancel.addEventListener('click', () => close(false));

      go.addEventListener('click', async () => {
        running = true;
        go.disabled = true;
        for (const el of [dur, gamma, bright]) el.disabled = true;
        bar.hidden = false;
        const frames = +dur.value * FPS;
        bar.max = frames;
        bar.value = 0;
        status.textContent = 'Rendering…';
        const t0 = performance.now();
        try {
          const channels = await runtime.render({
            start: 0, frames, fps: FPS, gamma: +gamma.value, brightness: +bright.value / 100,
            onProgress: (done) => {
              bar.value = done;
              const pct = Math.round((done / frames) * 100);
              const el = (performance.now() - t0) / 1000;
              const eta = done > 0 ? (el / done) * (frames - done) : 0;
              status.textContent = `Rendering… ${pct}% (${done.toLocaleString()} / ${frames.toLocaleString()} frames${eta > 1 ? `, about ${Math.ceil(eta)} s left` : ''})`;
            },
          });
          status.textContent = 'Writing the file…';
          const { writeFseq } = await import('../fseq.js');
          const realFrames = Math.floor(channels.length / channelCount) || frames;
          const bytes = writeFseq({ channelCount, frames: realFrames, stepMs: 1000 / FPS, data: channels });
          download(bytes, `${slugify(title, 'folly-look')}.fseq`);
          toast(`Exported ${realFrames.toLocaleString()} frames (${(bytes.length / 1e6).toFixed(1)} MB).`, { kind: 'ok' });
          running = false;
          close(true);
        } catch (err) {
          running = false;
          status.textContent = err.message || String(err);
          status.classList.add('form-error');
          go.disabled = false;
          for (const el of [dur, gamma, bright]) el.disabled = false;
        }
      });

      return [
        h('div', { class: 'export-fields' },
          h('div', { class: 'field slider-field' }, h('label', { for: ids.d, text: 'Duration' }), dur, durOut),
          h('div', { class: 'field slider-field' }, h('label', { for: ids.g, text: 'Gamma' }), gamma, gammaOut),
          h('p', { class: 'field-hint', text: '1.0 sends values as previewed. Use about 2.2 when the controller (FPP / the F48s) applies no gamma of its own, so the LEDs look like the screen.' }),
          h('div', { class: 'field slider-field' }, h('label', { for: ids.b, text: 'Brightness' }), bright, brightOut)),
        info, bar, status,
        h('div', { class: 'dialog-actions' }, cancel, go),
      ];
    },
  });
}

export function exportLookJson({ title, summary, layers }) {
  const data = JSON.stringify({ title, summary, layers }, null, 2) + '\n';
  download(data, `${slugify(title, 'folly-look')}.json`, 'application/json');
}
