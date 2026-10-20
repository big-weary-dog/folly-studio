---
looks: A colour swells up from the ground over a base colour, then sinks back like a breath.
---
The layer breathes: a `body` colour rises from the ground until it fills the layer, then drains back down, about one
breath every six seconds, over the `low` colour, dimmed, beneath. A **colour-wash** is faded by **edge-fade** whose
position rides a sine LFO, and a second **colour-wash** sits under it. A calm, organic bed for ambient moments or a
held chord. **rising-sweep** sends a band up repeatedly instead of filling; **rose-bloom** opens from a centre and
holds.

## Overrides
- edge-fade.position: the breath. Its LFO's `rate` sets the tempo (0.17 Hz ≈ 6 s; 0.1 for slower, or
  `"unit": "beats"` with rate 0.25 for a breath a bar). A plain number freezes the tide at that height.
- edge-fade.width: how soft the tide line is; 0.1 is a crisp waterline, 1 a gentle gradient.
- edge-fade.direction: where it swells from. `down` pours from the top; `out` swells from the layer's centre;
  `in` closes from the rim.
- colour-wash.colours: the swelling colour; colour-wash.speed moves it slowly through its pick (0 to hold one).
- colour-wash#2.colours and colour-wash#2.brightness: the colour underneath and how dim it is (0.3).

## Pairings
- On the whole rig as the base layer, with an element layer above.
- Add **anchor** at the end with direction `out` to breathe out from the rose or each tower.
- Bind the LFO's rate to a macro for a breath that quickens as the show builds.

## Pitfalls
- The LFO spans the whole position range (0 to 1), so each breath empties the layer and fills it fully.
- Faster than about 0.5 Hz it stops reading as a breath and becomes a whole-rig pulse; keep well under 3 Hz.
