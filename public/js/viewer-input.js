// The viewer's input: drag to orbit (with inertia), right-drag or two fingers to pan, wheel or
// pinch to zoom, double-click to reset, and the keys (arrows orbit, Alt+arrows pan, +/- zoom).

import { initGL } from './viewer-gl.js';

const lerp = (a, b, t) => a + (b - a) * t;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Bind input on v.canvas; the listeners are kept in v._listeners for destroy(). */
export function bindInput(v) {
  const c = v.canvas;
  const L = v._listeners = [];
  const pinch = () => {
    const [a, b] = [...v.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  const on = (type, fn, opts) => { c.addEventListener(type, fn, opts); L.push([type, fn, opts]); };

  on('contextmenu', (e) => e.preventDefault());
  on('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    c.setPointerCapture?.(e.pointerId);
    v.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    v.tween = null;
    v.inertia = null;
    if (v.pointers.size === 1) {
      const pan = e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey;
      v.drag = { mode: pan ? 'pan' : 'rotate', vx: 0, vy: 0, t: performance.now() };
    } else if (v.pointers.size === 2) {
      v.drag = { mode: 'pinch', ...pinch() };
    }
  });
  on('pointermove', (e) => {
    const p = v.pointers.get(e.pointerId);
    if (!p || !v.drag) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (v.drag.mode === 'pinch') {
      if (v.pointers.size < 2) return;
      const s = pinch();
      if (s.dist > 0 && v.drag.dist > 0) v._zoom(v.drag.dist / s.dist);
      v._pan(s.mx - v.drag.mx, s.my - v.drag.my);
      Object.assign(v.drag, s);
    } else if (v.drag.mode === 'rotate') {
      const now = performance.now();
      const dt = Math.max(1, now - v.drag.t);
      v.drag.vx = lerp(v.drag.vx, dx / dt, 0.5);
      v.drag.vy = lerp(v.drag.vy, dy / dt, 0.5);
      v.drag.t = now;
      v._rotate(dx, dy);
    } else {
      v._pan(dx, dy);
    }
  });
  const release = (e) => {
    if (!v.pointers.delete(e.pointerId)) return;
    if (v.pointers.size === 0) {
      const d = v.drag;
      if (d && d.mode === 'rotate' && !v.reduced.matches && performance.now() - d.t < 80) {
        const speed = Math.hypot(d.vx, d.vy);
        if (speed > 0.05) v.inertia = { vx: d.vx * 16, vy: d.vy * 16 };
      }
      v.drag = null;
    } else if (v.pointers.size === 1) {
      v.drag = { mode: 'rotate', vx: 0, vy: 0, t: performance.now() };
    }
  };
  on('pointerup', release);
  on('pointercancel', release);
  on('lostpointercapture', release);
  on('wheel', (e) => {
    e.preventDefault();
    if (v.tween) v._settleTween();
    v.tween = null;
    v.inertia = null;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
    v._zoom(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0012)));
  }, { passive: false });
  on('dblclick', (e) => { e.preventDefault(); v.resetView(); });
  on('keydown', (e) => {
    const step = e.shiftKey ? 40 : 15, k = e.key, arrow = ARROWS[k];
    if (arrow) v[e.altKey ? '_pan' : '_rotate'](arrow[0] * step, arrow[1] * step);
    else if (k === '+' || k === '=') v._zoom(0.88);
    else if (k === '-' || k === '_') v._zoom(1 / 0.88);
    else if (k === 'Home' || k === '0') v.resetView();
    else return;
    e.preventDefault();
    v.tween = null;
  });
  on('webglcontextlost', (e) => { e.preventDefault(); v.ok = false; });
  on('webglcontextrestored', () => { initGL(v); v.invalidate(); });
}
