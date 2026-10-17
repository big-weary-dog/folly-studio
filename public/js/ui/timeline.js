// The timeline (SPEC "Timeline"): a row per layer, top first, clips on a ruler, a playhead (all that moves per
// frame). Wide: dragged in the dock; phones: strips and the clip's numbers (timeline-tools.js).
import { h, keyed, pref, randomId, stylesheet, toast } from './dom.js';
import {
  addClip, clock, contentEnd, DEFAULT_DURATION, importLook, MAX_DURATION, removeClip, rulerStep, shownFades, snapStep,
} from './timeline-model.js';
import { attachInput, buildTools } from './timeline-tools.js';

const NAMES_W = 112;           // the layer-name column on a wide screen
const RULER_H = 16;
const MAX_PPS = 200;           // pixels a second, fully zoomed in
const MAX_WIDTH = 120000;      // and never wider than this

await stylesheet('/css/timeline.css');

export class Timeline {
  // host: { layers(), look(), selectedId(), time(), toolsSlot, onSelectLayer(id), onEdit({ live }), onSeek(t),
  //   signedOut() }
  constructor(host) {
    Object.assign(this, { host, mode: 'wide', pps: 1, fit: true, namesW: NAMES_W, viewW: 0, scrollX: 0, t: 0, px: -1,
      dragging: false, snapMode: pref('studio.snap') || 'grid' });
    this.sel = null;                       // the selected clip: { id, index }
    this.rows = new Map();                 // layer id → row parts

    this.canvas = h('canvas', { class: 'tl-ruler-canvas', 'aria-hidden': 'true' });
    this.ruler = h('div', { class: 'tl-ruler', title: 'Click or drag to move the playhead' }, this.canvas);
    this.rowsEl = h('div', { class: 'tl-rows' });
    this.head = h('div', { class: 'tl-playhead', 'aria-hidden': 'true' });
    // Automation lanes (timeline-auto.js) load once a look has some or asks for some.
    this.auto = null;
    this.autoSlot = h('div', { class: 'tl-auto-head' }, h('div', { class: 'tl-corner tl-auto-corner',
      text: 'Automation' }), h('div', { class: 'tl-auto-tools' }, h('button', { type: 'button', class: 'btn small',
      text: '+ Automate…', onClick: () => this.loadAuto(true) })));
    this.inner = h('div', { class: 'tl-inner' },
      h('div', { class: 'tl-head-row' }, h('div', { class: 'tl-corner', text: 'Layers' }), this.ruler),
      this.rowsEl, this.autoSlot, this.head);
    this.scroll = h('div', { class: 'tl-scroll', tabindex: -1, role: 'group',
      'aria-label': 'Timeline, top layer first. On a selected clip, arrows move it, Shift+arrows '
        + 'change its length and Delete removes it.' }, this.inner);
    this.tools = buildTools(this);
    this.el = h('div', { class: 'tl', dataset: { mode: 'wide' } }, this.scroll);

    this.onScroll = () => {
      this.scrollX = this.scroll.scrollLeft;
      this.drawRuler();
      this.placeHead();
    };
    this.scroll.addEventListener('scroll', this.onScroll, { passive: true });
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.scroll);
    this.detach = attachInput(this);
  }

  get look() { return this.host.look(); }
  get duration() { return this.look.duration || DEFAULT_DURATION; }
  layerById(id) { return this.host.layers().find((l) => l.id === id) || null; }
  /** The snap step (s; 0: none). */
  step() { return snapStep(this.snapMode, this.look.bpm); }
  /** How far an edit may push clip c: the look's end, or c's if past it. */
  limit(c) { return Math.max(this.duration, c ? c.end : 0); }
  /** The time the view spans: the look, and any clip past its end. */
  span() {
    return Math.max(1, this.duration, contentEnd(this.host.layers().filter((l) => l.clips?.length), 0));
  }

  selected() {
    const layer = this.sel && this.layerById(this.sel.id);
    const clip = layer?.clips?.[this.sel.index];
    return clip ? { layer, index: this.sel.index, clip } : null;
  }

  setMode(narrow) {
    this.mode = narrow ? 'narrow' : 'wide';
    this.el.dataset.mode = this.mode;
    this.namesW = narrow ? 0 : NAMES_W;
    this.tools.place(narrow);
    if (narrow) {
      this.el.prepend(this.tools.el);
      this.el.append(this.tools.inspector);
    } else {
      this.host.toolsSlot.append(this.tools.el);
      this.tools.el.append(this.tools.inspector);
    }
    this.fit = true;
    this.layout();
  }

  // Geometry: on resize, zoom and length changes, never per frame.
  layout() {
    const w = this.scroll.clientWidth;
    if (!w) return;
    this.viewW = Math.max(1, w - this.namesW);
    const span = this.span();
    const fitPps = this.viewW / span;
    if (this.fit || this.pps < fitPps) { this.pps = fitPps; this.fit = true; }
    this.pps = Math.min(this.pps, Math.max(fitPps, Math.min(MAX_PPS, MAX_WIDTH / span)));
    this.contentW = Math.max(this.viewW, Math.ceil(span * this.pps));
    const s = this.el.style;
    const bpm = this.look.bpm;
    const beatPx = bpm ? (60 / bpm) * this.pps : 0;
    s.setProperty('--tl-names', `${this.namesW}px`);
    s.setProperty('--tl-w', `${this.contentW}px`);
    s.setProperty('--tl-dur', `${this.duration * this.pps}px`);
    s.setProperty('--tl-grid', `${beatPx >= 6 ? beatPx : rulerStep(this.pps) * this.pps}px`);
    this.el.classList.toggle('beats', beatPx >= 6);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(this.viewW * this.dpr)) {
      this.canvas.width = Math.round(this.viewW * this.dpr);
      this.canvas.height = RULER_H * this.dpr;
      this.canvas.style.width = `${this.viewW}px`;
    }
    if (!this.colors) {
      const cs = getComputedStyle(this.el);
      const v = (name, d) => cs.getPropertyValue(name).trim() || d;
      this.colors = { tick: v('--tl-tick', '#4d4258'), text: v('--text-3', '#a3949f'), end: v('--amber', '#f4b04f'),
        beat: v('--cobalt-t', '#9bb6ff') };
    }
    this.scrollX = this.scroll.scrollLeft;
    for (const r of this.rows.values()) r.sig = '';
    this.render();
    this.drawRuler();
    this.placeHead(true);
  }

  /** The automation lanes in place of their placeholder (open: focus what can be automated). */
  loadAuto(open = false) {
    this.autoP ||= import('./timeline-auto.js').then(({ AutoLanes }) => {
      this.auto = new AutoLanes(this);
      this.autoSlot.replaceWith(this.auto.el);
      this.auto.render();
    });
    if (open) this.autoP.then(() => this.auto.add.focus());
  }

  /** Zoom by `factor`, keeping the time under `anchor` (px into the lanes) in place. */
  zoom(factor, anchor = this.viewW / 2) {
    if (this.mode !== 'wide') return;
    const t = (this.scrollX + anchor) / this.pps;
    const fitPps = this.viewW / this.span();
    this.pps = Math.max(fitPps, Math.min(MAX_PPS, this.pps * factor));
    this.fit = this.pps <= fitPps * 1.001;
    this.layout();
    this.scroll.scrollLeft = Math.max(0, t * this.pps - anchor);
    this.onScroll();
  }

  zoomToFit() { this.fit = true; this.layout(); }

  /** Rows in line with the look: cheap when nothing changed. */
  render() {
    const layers = this.host.layers();
    const selectedId = this.host.selectedId();
    if (this.sel && (this.sel.id !== selectedId || !this.selected())) this.sel = null;
    keyed(this.rowsEl, this.rows, [...layers].reverse(), (l) => l.id, (l) => this.makeRow(l),
      (r, l) => this.paintRow(r, l, l.id === selectedId));
    this.el.classList.toggle('tl-empty', !layers.length);
    if (this.auto) this.auto.render(); else if (this.look.automation) this.loadAuto();
    this.tools.update();
  }

  makeRow(l) {
    const name = h('button', { type: 'button', class: 'tl-name', onClick: () => this.host.onSelectLayer(l.id) });
    const always = h('div', { class: 'tl-always' }, h('span'));
    const lane = h('div', { class: 'tl-lane' }, always);
    const el = h('div', { class: 'tl-row', dataset: { id: l.id } }, name, lane);
    return { el, name, lane, always, clips: [], sig: '' };
  }

  paintRow(r, l, selected) {
    const clips = l.clips || [];
    const selIndex = this.sel && this.sel.id === l.id ? this.sel.index : -1;
    const title = l.title || 'Layer';
    const sig = `${title}|${selected}|${selIndex}|${l.blend}|${JSON.stringify(clips)}|${this.pps}|${this.duration}`;
    if (sig === r.sig) return;
    r.sig = sig;
    r.el.dataset.blend = l.blend || 'add';     // clips take the glass of the layer's blend
    r.el.classList.toggle('selected', selected);
    r.name.textContent = title;
    r.always.hidden = clips.length > 0;
    r.always.firstChild.textContent = this.mode === 'wide' ? 'Always on · double-click to place a clip'
      : 'Always on';
    while (r.clips.length < clips.length) r.clips.push(this.makeClip(r));
    while (r.clips.length > clips.length) r.clips.pop().remove();
    const pps = this.pps;
    clips.forEach((c, i) => {
      const el = r.clips[i];
      el.dataset.i = String(i);
      el.style.left = `${c.start * pps}px`;
      el.style.width = `${Math.max(2, (c.end - c.start) * pps)}px`;
      const [fi, fo] = shownFades(c);     // as they play: a short clip squeezes long fades
      el.style.setProperty('--fi', `${fi * pps}px`);
      el.style.setProperty('--fo', `${fo * pps}px`);
      el.classList.toggle('selected', i === selIndex);
      el.classList.toggle('past-end', c.start >= this.duration);
      const when = `${clock(c.start)} to ${clock(c.end)}`;
      const fades = c.fadeIn || c.fadeOut ? `, fading in ${c.fadeIn} s and out ${c.fadeOut} s` : '';
      el.setAttribute('aria-label', `${title}, clip ${i + 1} of ${clips.length}: ${when}${fades}`);
      el.title = when + fades;
    });
  }

  makeClip(r) {
    const el = h('div', { class: 'tl-clip', tabindex: 0, role: 'button' },
      h('span', { class: 'tl-ramp tl-ramp-in' }), h('span', { class: 'tl-ramp tl-ramp-out' }),
      h('span', { class: 'tl-fh tl-fh-in', title: 'Drag to fade in' }),
      h('span', { class: 'tl-fh tl-fh-out', title: 'Drag to fade out' }));
    el.addEventListener('focus', () => {
      const id = r.el.dataset.id, i = +el.dataset.i;
      if (!this.sel || this.sel.id !== id || this.sel.index !== i) this.selectClip(id, i);
    });
    r.lane.append(el);
    return el;
  }

  clipEl(id, index) { return this.rows.get(id)?.clips[index] || null; }

  /** Select clip `index` of layer `id` (null: just the layer), and its layer. */
  selectClip(id, index, { focus = false } = {}) {
    this.sel = index === null || index === undefined ? null : { id, index };
    if (this.host.selectedId() !== id) this.host.onSelectLayer(id);   // which re-renders us
    else this.render();
    if (focus && this.sel) this.clipEl(id, index)?.focus({ preventScroll: true });
  }

  /** New clips for a layer. notify: 'commit' (done), 'live' (mid-drag, preview too) or 'none'. */
  setClips(layer, clips, { notify = 'commit', select } = {}) {
    if (clips.length) layer.clips = clips; else delete layer.clips;
    if (select !== undefined) this.sel = select === null ? null : { id: layer.id, index: select };
    const r = this.rows.get(layer.id);
    if (r) this.paintRow(r, layer, layer.id === this.host.selectedId());
    if (this.span() * this.pps > this.contentW + 1) this.layout();
    this.tools.update();
    if (notify !== 'none') this.host.onEdit({ live: notify === 'live' });
  }

  /** A clip a bar (or 4 s) long on `layer` at time t, selected. */
  addClipAt(layer, t) {
    if (!layer) return;
    const bpm = this.look.bpm;
    const made = addClip(layer.clips, t, bpm ? 240 / bpm : 4, this.step(), this.duration);
    if (!made) {
      const why = t >= this.duration ? 'That is after the end of the look: make it longer first.' : 'No room there.';
      toast(why, { kind: 'warn' });
      return;
    }
    this.setClips(layer, made.clips, { select: made.index });
    this.clipEl(layer.id, made.index)?.focus({ preventScroll: true });
  }

  removeSelected() {
    const s = this.selected();
    if (!s) return;
    const before = s.layer.clips.slice();
    this.setClips(s.layer, removeClip(before, s.index), { select: null });
    this.scroll.focus({ preventScroll: true });
    const text = s.layer.clips ? 'Clip removed.' : `No clips left: “${s.layer.title}” plays throughout again.`;
    toast(text, { action: { label: 'Undo', onClick: () => this.setClips(s.layer, before, { select: s.index }) } });
  }

  setDuration(d) {
    this.look.duration = d;
    this.layout();
    this.host.onEdit({});
  }

  setBpm(bpm) {
    if (bpm) this.look.bpm = bpm; else delete this.look.bpm;
    if (!bpm && this.snapMode === 'beat') this.setSnap('grid');
    this.layout();
    this.host.onEdit({});
  }

  setSnap(mode) {
    this.snapMode = mode;
    pref('studio.snap', mode);
    this.tools.update();
  }

  /** Play another look after this one → an error, or ''. */
  importLook(other) {
    const look = this.look;
    const r = importLook(look.layers, this.duration, other, () => randomId('l'));
    if (r.error) return r.error;
    const before = { layers: look.layers, duration: look.duration, selected: this.host.selectedId() };
    const apply = (layers, duration, selected) => {
      Object.assign(look, { layers, duration });
      this.fit = true;
      this.host.onEdit({});
      this.host.onSelectLayer(selected);
      this.layout();
    };
    apply(r.layers, r.duration, r.layers[r.layers.length - 1].id);
    const n = r.layers.length - before.layers.length;
    const where = `${clock(r.start)}–${clock(r.end)}`;
    const ended = r.ended ? ` Layers that played throughout now end at ${clock(r.start)}.` : '';
    toast(`Added ${n} layer${n > 1 ? 's' : ''} from “${other.title || 'a look'}”, ${where}.${ended}`, {
      timeout: 8000,
      action: { label: 'Undo', onClick: () => apply(before.layers, before.duration, before.selected) },
    });
    return '';
  }

  drawRuler() {
    const ctx = this.ctx || (this.ctx = this.canvas.getContext('2d'));
    if (!ctx || !this.viewW) return;
    const { pps, viewW: w, dpr, colors } = this;
    const x0 = this.mode === 'wide' ? this.scrollX : 0;
    const last = Math.min(MAX_DURATION, (x0 + w) / pps);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, RULER_H);
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    const minor = rulerStep(pps) / 4;
    for (let k = Math.floor(x0 / pps / minor); k * minor <= last; k++) {
      const x = Math.round(k * minor * pps - x0);
      ctx.fillStyle = colors.tick;
      ctx.fillRect(x, k % 4 ? 12 : 8, 1, RULER_H);
      if (k % 4 === 0) { ctx.fillStyle = colors.text; ctx.fillText(clock(k * minor), x + 3, 1); }
    }
    const beat = this.look.bpm ? 60 / this.look.bpm : 0;
    if (beat && beat * pps >= 6) {
      ctx.fillStyle = colors.beat;
      for (let k = Math.ceil(x0 / pps / beat); k * beat <= last; k++) {
        ctx.fillRect(Math.round(k * beat * pps - x0), 14, 1, 2);
      }
    }
    ctx.fillStyle = colors.end;
    ctx.fillRect(Math.round(this.duration * pps - x0) - 1, 0, 2, RULER_H);
  }

  /** Per frame: the playhead (a transform); while playing, the view pages along. */
  setTime(t, playing) {
    this.t = t;
    const px = Math.round(t * this.pps);
    if (px === this.px) return;
    this.px = px;
    const off = px > this.scrollX + this.viewW - 6 || px < this.scrollX;
    if (playing && off && this.mode === 'wide' && !this.dragging) {
      this.scroll.scrollLeft = Math.max(0, px - 16);     // its scroll event redraws the ruler
    }
    this.placeHead();
  }

  placeHead(force) {
    if (force) this.px = Math.round(this.t * this.pps);
    const x = this.px;
    const away = this.mode === 'wide' && (x < this.scrollX - 1 || x > this.scrollX + this.viewW);
    if (this.head.hidden !== away) this.head.hidden = away;
    this.head.style.transform = `translateX(${x}px)`;
  }

  destroy() {
    this.ro.disconnect();
    this.detach();
    this.scroll.removeEventListener('scroll', this.onScroll);
    this.tools.el.remove();
  }
}
