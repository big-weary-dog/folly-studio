---
looks: The look above plays as a drum part on the beat: hits light it and fade, rests go dark or dip.
---
A step sequencer on the look's bpm. Each step of `pattern` is `X` (a loud hit), `x` (a hit, 0.6) or `.` (a rest);
a hit lights what is above it and fades over decay. Lines split by spaces are separate drum parts: with one tag they
go to its places in turn (`arch`: arch 1 plays line 1, arch 2 line 2, …), with several tags line i plays on the
i-th tag (`tower arch rose`: kick, snare, hat). Places outside the tag are left as they are. It seeks exactly.

## Params
- pattern: 16 steps at 4 steps a beat is a bar. `X...x...X...x...` a four-on-the-floor; `X.......X.X.....`
  a kick; `....X.......X...` a backbeat; `x.x.x.x.x.x.x.x.` hats.
- tag: `all` for one line everywhere; a tag with parts (`arch`, `ring`, `spirelet`) for call and answer.
- steps: 2 eighths, 3 triplets.
- swing: 0.5–0.7 for a shuffle.
- decay: 0.1–0.2 tight; 0.3–0.5 for a pump that breathes.
- amount: 0.3–0.5 is a sidechain pump.

## Pairings
- **colour-wash** or **clouds** → rhythm amount 0.4, decay 0.4, `X...X...X...X...`: the bed pumps to the kick.
- **bars** → rhythm, tag `tower arch rose`, three lines: a kit across the façade.
- **sparkle** → rhythm `X... .X.. ..X. ...X` on `ring`: the beat steps out across the rose's rings.
- **fire** → rhythm invert, `....X.......X...`: the flames cut out on the backbeat, a stutter.

## Pitfalls
- A line with over 3 hits in any second (8th hats at 120 bpm) only dips to a quarter of its depth, wherever it plays,
  so it shimmers instead of flashing (the flash check). For hits that land hard, keep each line to 3 a second.
- Swing does nothing to a line whose hits all sit on even steps (`X...X...`).
- A line of only rests stays dark at amount 1.
- Characters other than `X` and `x` are rests; a line's length is its loop, so lines of different lengths drift
  against each other (a polyrhythm).
