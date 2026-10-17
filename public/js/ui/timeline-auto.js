// Automation lanes under the timeline's layers (SPEC "Looks"): a lane per automated global (energy, a macro), its
// points joined by straight lines and held at either end. Click a lane to add a point, drag one to move it,
// double-click one to remove it. Edits go to look.automation in place and through the timeline's onEdit.
import { h, humanize, svg } from './dom.js';
import { clock } from './timeline-model.js';

const H = 34, PAD = 4;              // lane height and the room kept above and below the line (px)
const MAX_POINTS = 256;

export class AutoLanes {
  constructor(tl) {
    Object.assign(this, { tl, rows: new Map(), sig: '', drag: null });
    this.add = h('select', { class: 'tl-auto-add', 'aria-label': 'Automate a global' });
    this.add.addEventListener('change', () => this._addLane(this.add.value));
    this.el = h('div', { class: 'tl-auto' },
      h('div', { class: 'tl-auto-head' }, h('div', { class: 'tl-corner tl-auto-corner', text: 'Automation' }),
        h('div', { class: 'tl-auto-tools' }, this.add)),
      this.lanesEl = h('div', { class: 'tl-auto-lanes' }));
  }

  get look() { return this.tl.look; }
  /** What can be automated: energy and the look's macros, with their ranges. */
  ranges() {
    const macros = this.look.globals?.macros || {};
    return new Map([['energy', { min: 0, max: 1, value: this.look.globals?.energy ?? 0.5 }],
      ...Object.entries(macros).map(([n, m]) => [n, { min: m.min, max: m.max, value: m.value }])]);
  }

  render() {
    const ranges = this.ranges(), auto = this.look.automation || {};
    const sig = JSON.stringify([auto, [...ranges], this.tl.pps, this.tl.contentW, this.tl.mode]);
    if (sig === this.sig || this.drag) return;
    this.sig = sig;
    const free = [...ranges.keys()].filter((n) => !auto[n]);
    this.add.replaceChildren(h('option', { value: '', text: free.length ? '+ Automate…' : 'All automated' }),
      ...free.map((n) => h('option', { value: n, text: humanize(n) })));
    this.add.disabled = !free.length;
    const names = Object.keys(auto).filter((n) => ranges.has(n));
    for (const [n, r] of this.rows) if (!names.includes(n)) { r.row.remove(); this.rows.delete(n); }
    names.forEach((n, i) => {
      let r = this.rows.get(n);
      if (!r) { r = this._row(n); this.rows.set(n, r); }
      if (this.lanesEl.children[i] !== r.row) this.lanesEl.insertBefore(r.row, this.lanesEl.children[i] || null);
      this._paint(r, auto[n], ranges.get(n));
    });
  }

  _addLane(name) {
    const r = this.ranges().get(name);
    if (!r) return;
    this.look.automation ||= {};
    this.look.automation[name] = [[0, r.value], [Math.round(this.tl.duration * 1000) / 1000, r.value]];
    this.sig = '';
    this.render();
    this.tl.host.onEdit({});
  }

  _row(name) {
    const r = { name };
    r.label = h('span', { class: 'tl-auto-name', text: humanize(name) });
    const remove = h('button', { type: 'button', class: 'tl-auto-del', text: '×',
      'aria-label': `Stop automating ${name}`, title: 'Remove this lane', onClick: () => {
        delete this.look.automation[name];
        if (!Object.keys(this.look.automation).length) delete this.look.automation;
        this.sig = '';
        this.render();
        this.tl.host.onEdit({});
      } });
    r.svg = svg('svg', { class: 'tl-auto-svg', height: H, role: 'img' });
    r.line = svg('polyline', { class: 'tl-auto-line' });
    r.svg.append(r.line);
    r.dots = [];
    r.row = h('div', { class: 'tl-row tl-auto-row', dataset: { name } }, h('div', { class: 'tl-name tl-auto-label' },
      r.label, remove), h('div', { class: 'tl-lane tl-auto-lane' }, r.svg));
    r.svg.addEventListener('pointerdown', (e) => this._down(r, e));
    r.svg.addEventListener('pointermove', (e) => this._move(e));
    r.svg.addEventListener('pointerup', () => this._up());
    r.svg.addEventListener('pointercancel', () => this._up());
    r.svg.addEventListener('dblclick', (e) => this._remove(r, e));
    return r;
  }

  _xy(pts, range, i) {
    const k = (pts[i][1] - range.min) / (range.max - range.min || 1);
    return [pts[i][0] * this.tl.pps, PAD + (1 - k) * (H - 2 * PAD)];
  }

  _paint(r, pts, range) {
    r.range = range;
    const w = this.tl.contentW || 1;
    r.svg.setAttribute('width', String(w));
    r.svg.setAttribute('viewBox', `0 0 ${w} ${H}`);
    r.svg.setAttribute('aria-label', `${r.name}: ${pts.map(([t, v]) => `${clock(t)} ${v}`).join(', ')}`);
    const xy = pts.map((_, i) => this._xy(pts, range, i));
    r.line.setAttribute('points', [[0, xy[0][1]], ...xy, [w, xy[xy.length - 1][1]]].map((p) => p.join(',')).join(' '));
    while (r.dots.length < pts.length) {
      const c = svg('circle', { class: 'tl-auto-dot', r: 4.5 });
      r.svg.append(c);
      r.dots.push(c);
    }
    while (r.dots.length > pts.length) r.dots.pop().remove();
    r.dots.forEach((c, i) => {
      c.setAttribute('cx', String(xy[i][0]));
      c.setAttribute('cy', String(xy[i][1]));
      c.dataset.i = String(i);
    });
  }

  /** Pointer → [t, v] on lane r (t snapped like clips, within the look; v within the range). */
  _at(r, e) {
    const box = r.svg.getBoundingClientRect(), range = r.range;
    const step = this.tl.step();
    let t = Math.max(0, Math.min(this.tl.duration, (e.clientX - box.left) / this.tl.pps));
    if (step) t = Math.round(t / step) * step;
    const k = 1 - (e.clientY - box.top - PAD) / (H - 2 * PAD);
    const v = range.min + Math.max(0, Math.min(1, k)) * (range.max - range.min);
    return [Math.round(t * 1000) / 1000, Math.round(v * 1000) / 1000];
  }

  _down(r, e) {
    if (e.button !== 0 || e.detail > 1) return;
    const pts = this.look.automation[r.name];
    let i = e.target.dataset?.i !== undefined ? +e.target.dataset.i : -1;
    if (i < 0) {
      if (pts.length >= MAX_POINTS) return;
      const p = this._at(r, e);
      if (pts.some((q) => q[0] === p[0])) return;
      pts.push(p);
      pts.sort((a, b) => a[0] - b[0]);
      i = pts.indexOf(p);
    }
    this.drag = { r, point: pts[i] };
    r.svg.setPointerCapture(e.pointerId);
    this._paint(r, pts, r.range);
    this.tl.host.onEdit({ live: true });
  }

  _move(e) {
    const d = this.drag;
    if (!d) return;
    const pts = this.look.automation[d.r.name];
    const [t, v] = this._at(d.r, e);
    if (!pts.some((q) => q !== d.point && q[0] === t)) d.point[0] = t;
    d.point[1] = v;
    pts.sort((a, b) => a[0] - b[0]);
    this._paint(d.r, pts, d.r.range);
    this.tl.host.onEdit({ live: true });
  }

  _up() {
    if (!this.drag) return;
    this.drag = null;
    this.sig = '';
    this.tl.host.onEdit({});
  }

  _remove(r, e) {
    const i = e.target.dataset?.i;
    const pts = this.look.automation[r.name];
    if (i === undefined || pts.length <= 1) return;
    pts.splice(+i, 1);
    this.sig = '';
    this.render();
    this.tl.host.onEdit({});
  }
}
