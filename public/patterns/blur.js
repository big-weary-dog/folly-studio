// Blur: softens the chain's colour across neighbouring LEDs, along each strand (wire), through space, or both: hard
// edges melt, a chase glows. The core runs it over the whole layer at once (SPEC "Spatial modules"), counting only
// this layer's LEDs; filter() is what a core without spatial modules does. radius (metres), mode, amount.
const spatial = 'blur';
const params = {
  radius: { value: 0.4, min: 0, max: 1.5, step: 0.01, label: 'Radius (metres; along the wire, metres of wire)' },
  mode: { value: 'space', type: 'choice', options: ['wire', 'space', 'both'], label: 'Along the wire, in space, both' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Mix with the sharp colour' },
};

function filter(c) {
  return c;
}
