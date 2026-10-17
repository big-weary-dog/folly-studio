// Transport: play/pause, restart, time readout, scrub, speed.
import { h, formatTime, nextId } from './dom.js';

export const SPEEDS = [0.25, 0.5, 1, 2, 4];

export class Transport {
  constructor(container, { onPlay, onSeek, onSpeed, onRestart }) {
    const scrubId = nextId('scrub'), speedId = nextId('speed');
    this.play = h('button', { type: 'button', class: 'tp-play', 'aria-label': 'Pause' });
    this.play.addEventListener('click', () => onPlay());
    this.restart = h('button', { type: 'button', class: 'tp-btn tp-restart', 'aria-label': 'Back to start', title: 'Back to start' });
    this.restart.addEventListener('click', () => onRestart());
    this.time = h('span', { class: 'tp-time', 'aria-label': 'Time' });
    this.scrub = h('input', { type: 'range', id: scrubId, class: 'tp-scrub', min: 0, max: 30, step: 0.01, value: 0 });
    this.scrubbing = false;
    this.scrub.addEventListener('pointerdown', () => { this.scrubbing = true; });
    this.scrub.addEventListener('pointerup', () => { this.scrubbing = false; });
    this.scrub.addEventListener('blur', () => { this.scrubbing = false; });
    this.scrub.addEventListener('input', () => onSeek(+this.scrub.value));
    this.speed = h('select', { id: speedId, class: 'tp-speed' },
      SPEEDS.map((s) => h('option', { value: String(s), text: `${s}×` })));
    this.speed.value = '1';
    this.speed.addEventListener('change', () => onSpeed(+this.speed.value));
    this.stats = h('span', { class: 'tp-stats', 'aria-hidden': 'true' });
    this.el = h('div', { class: 'transport', role: 'group', 'aria-label': 'Transport' },
      this.restart, this.play, this.time,
      h('label', { for: scrubId, class: 'sr-only', text: 'Scrub time' }), this.scrub,
      h('label', { for: speedId, class: 'sr-only', text: 'Speed' }), this.speed,
      this.stats);
    container.append(this.el);
    this._last = { playing: null, t: -1, duration: -1, at: 0 };
  }

  /** Cheap to call every frame: touches the DOM only when something visible changes, and
   * the running clock at most ~8 times a second. */
  set(playing, t, duration, now = performance.now()) {
    const L = this._last;
    let force = false;
    if (playing !== L.playing) {
      L.playing = playing;
      force = true;
      this.play.classList.toggle('playing', playing);
      this.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      this.play.title = playing ? 'Pause (Space)' : 'Play (Space)';
    }
    if (duration !== L.duration) {
      L.duration = duration;
      force = true;
      this.scrub.max = String(duration);
    }
    if (t === L.t || (!force && playing && now - L.at < 120)) return;
    L.t = t;
    L.at = now;
    this.time.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
    if (!this.scrubbing) this.scrub.value = String(t);
  }

  setStats(text) {
    if (this.stats.textContent !== text) this.stats.textContent = text;
  }
}
