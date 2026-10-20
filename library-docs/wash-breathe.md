---
looks: A colour swells up from the ground over a base colour, then sinks back like a breath.
---
A calm, organic bed, one breath about every 6 s, for ambient moments or a held chord. **rising-sweep** sends bands up
instead; **rose-bloom** opens from a centre and holds.

## Overrides
- edge-fade.position: its LFO `rate` is the tempo (0.17 Hz ≈ 6 s; `"unit": "beats"` rate 0.25 for a breath a bar); a
  number freezes it.
- edge-fade.width: 0.1 a crisp waterline, 1 a gentle gradient.
- edge-fade.direction: `down` pours from the top; `out` swells from the centre; `in` closes from the rim.
- colour-wash.colours: the swelling colour.
- colour-wash#2.colours and colour-wash#2.brightness: the base colour and its dimness.

## Pairings
- Then **anchor** with direction `out`: breathes out from the rose or each tower.

## Pitfalls
- Above about 0.5 Hz it becomes a whole-rig pulse.
