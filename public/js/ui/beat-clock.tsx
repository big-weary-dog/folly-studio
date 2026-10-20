// The beat clock (SPEC "Param bindings"): beside a speed's number, on to count it per beat at the look's BPM (the
// param a `{ mod: 'beats', per }` binding), off for a plain number a second; the LFO's rate takes the same button.
export function BeatClock({ on, label, set }: { on: boolean; label: string; set: (on: boolean) => void }) {
  return <button type="button" class="beat-clock" aria-pressed={on} aria-label={`${label}: in time with the beat`}
    title={on ? 'In time with the beat: counts per beat at the look\'s BPM'
      : 'Per second: on to keep time with the beat'}
    onClick={() => set(!on)}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" /><path d="M8 4.5V8l2.5 1.75" /></svg>
  </button>;
}
