// The 3D view's input (viewer.ts): drag orbits (a flick coasts), right-drag, Shift-drag or two fingers pan, wheel or
// pinch zooms, double-click resets; with focus, arrows orbit, Alt+arrows pan, +/- zoom, Home or 0 resets.
import type { Viewer } from './viewer.ts';
import { initGL } from './viewer-gl.ts';

/** What a pointer is doing to the camera. */
export type Drag = { mode: 'pan' } | { mode: 'rotate'; vx: number; vy: number; t: number }
  | { mode: 'pinch'; dist: number; mx: number; my: number };
const ARROWS: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1],
  ArrowDown: [0, 1] };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
type Ev<K> = K extends keyof HTMLElementEventMap ? HTMLElementEventMap[K] : Event;

/** Listens on v's canvas; returns the removal. */
export function bindInput(v: Viewer) {
  const c = v.canvas, pointers = new Map<number, { x: number; y: number }>(), offs: (() => void)[] = [];
  const on = <K extends string>(type: K, fn: (e: Ev<K>) => void, opts?: AddEventListenerOptions) => {
    c.addEventListener(type, fn as EventListener, opts);
    offs.push(() => c.removeEventListener(type, fn as EventListener, opts));
  };
  /** Stop any glide where the camera is now, and any coasting. */
  const still = () => {
    if (v.tween) {
      v.tween = null;
      v.cam.target = [...v.cam.target];
      v._clampCam();
    }
    v.inertia = null;
  };
  const pinch = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  const rotating = (): Drag => ({ mode: 'rotate', vx: 0, vy: 0, t: performance.now() });
  on('contextmenu', (e) => e.preventDefault());
  on('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    c.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    still();
    if (pointers.size === 1) {
      const pan = e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey;
      v.drag = pan ? { mode: 'pan' } : rotating();
    } else if (pointers.size === 2) v.drag = { mode: 'pinch', ...pinch() };
  });
  on('pointermove', (e) => {
    const p = pointers.get(e.pointerId), d = v.drag;
    if (!p || !d) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (d.mode === 'pinch') {
      if (pointers.size < 2) return;
      const s = pinch();
      if (s.dist > 0 && d.dist > 0) v._zoom(d.dist / s.dist);
      v._pan(s.mx - d.mx, s.my - d.my);
      Object.assign(d, s);
    } else if (d.mode === 'rotate') {
      const now = performance.now(), dt = Math.max(1, now - d.t);
      d.vx = lerp(d.vx, dx / dt, 0.5);
      d.vy = lerp(d.vy, dy / dt, 0.5);
      d.t = now;
      v._rotate(dx, dy);
    } else v._pan(dx, dy);
  });
  const release = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    const d = v.drag;
    if (pointers.size === 1) v.drag = rotating();
    if (pointers.size) return;
    const flick = d?.mode === 'rotate' && performance.now() - d.t < 80 && Math.hypot(d.vx, d.vy) > 0.05;
    if (flick && !v.reduced.matches) v.inertia = { vx: d.vx * 16, vy: d.vy * 16 };
    v.drag = null;
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) on(type, release);
  on('wheel', (e) => {
    e.preventDefault();
    still();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
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
  on('webglcontextrestored', () => {
    initGL(v);
    v.playa = null;
    v.setMode(v.mode);
  });
  return () => { for (const off of offs) off(); };
}
