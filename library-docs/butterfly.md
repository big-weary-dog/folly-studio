---
looks: Flowing, swirling colour folded left to right, so both halves move as mirrored wings.
---
The **plasma** field (smooth **bars** pushed around by **turbulence**), mirrored by **mirror** so the right half of
the layer repeats the left like a pair of wings. Slow, psychedelic and symmetrical: on the whole rig the two towers and the two sides of the
portal move as mirror images round the rose. Reach for it as a busy, trippy bed. **palette-drift** is the calm
version (one colour moving over the whole layer); **kaleidoscope** or **radial-repeat** fold into more than two.

## Overrides
- bars.bars: colour bands across the layer; 8 broad blobs per wing, 24 busy marbling.
- bars.speed: how fast the colours flow; 0.1 calm, 0.6 churning.
- bars.colours: the colours it flows through; a role (`body`) keeps it in one family.
- turbulence.amount and turbulence.size: how far and how finely the bands swirl.
- mirror.height: also folds top onto bottom, a four-way butterfly. mirror.depth folds front onto back (towers and
  arches match front to back). mirror.along folds every wire at its middle.

## Pairings
- Over nothing on the whole rig as the bed, with a sparse element layer above (**sparkle**, **starfield**).
- Add **hue-shift** after the mirror (speed 0.05) for colours that keep travelling round the wheel.
- Add **anchor** at the end (tag `rose`) to fold round the rose's centre line rather than the layer's middle.

## Pitfalls
- The fold is round the middle of the layer's bounds: on an off-centre group (one side only) the seam lands in the
  wrong place; use **anchor** or place it on symmetrical groups.
- Turbulence size below ~0.15 turns to speckle on sparse groups (spirelets, spire strands).
