// Colour wash: fills the layer with one colour at a time, moving through Colours.
// Speed is colours a second (0: the first colour, still); Hold is the share of each colour's time spent still before
// it blends into the next (at most 0.8, so a change always takes a fifth of it). The one source that covers its
// layer: a bed for what is drawn over it.
const params = {
  colours: { value: 'all', type: 'color', label: 'Colours' },
  speed: { value: 0.2, min: 0, max: 2, step: 0.01, label: 'Speed (colours a second)' },
  hold: { value: 0.5, min: 0, max: 0.8, step: 0.01, label: 'Hold' },
  brightness: { value: 1, min: 0, max: 1, step: 0.01, label: 'Brightness' },
};

let now = [0, 0, 0];

function frame(t, P) {
  const x = clock('speed'), i = floor(x);
  const blend = smoothstep(min(P.hold, 0.8), 1, x - i);
  now = scale(mix(swatch('colours', i), swatch('colours', i + 1), blend), P.brightness);
}

function pixel() {
  return now;
}
