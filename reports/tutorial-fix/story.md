# The tutorial as one story: "Rose and arches"

**The finished look:** the rose window blooms ring by ring in jewel-coloured glass; comets of light run up and over
the main arches (and the small ones), turned to sweep across them; a starfield under everything. It builds on
the timeline: the rose first, the arches joining after a few seconds, and later everything rises on one fader.
Saved as your own look.

The details live where the Folly is most intricate: the **rose window** (rig tag `rose`; its rings `ring`; the
**Rose** camera view) and the **main arches** (`arch-main`; the small ones `arch-mini`). Every change in the story
lands on one of those, and each step puts the camera where that change is clearly seen.

**Order:** getting around first; then you describe a basic idea, which opens a ready-made tutorial look (no model
runs); then every later chapter keeps editing that look, basics before advanced. Values that move by themselves (∿:
LFOs, macros, automation) are their own advanced chapter.

1. **Getting around**: the preview, the camera, play, the pages
2. **From an idea**: describe the look; it opens in the Studio
3. **Modules and colour**: numbers, choices and colours on one module; the palette
4. **Layers and chains**: solo, warps and filters, where a layer plays, a preset, level, blend, order
5. **Time**: the tempo, the beat, a clip
6. **Values that move** (advanced): ∿, three LFO shapes, a macro on two values, automation
7. **Keep it**: try and undo, save, Live

Each chapter after the second opens where the last one ended (its practice look is the story so far), so any
chapter can be replayed on its own. Every step names the exact control and change from where that control actually
starts (a test fails if a step's goal is already met when it opens), with a sentence on why it helps the look.

**Repeats on purpose, each a different example.** Tuning comes back for each kind of control: a number (Speed,
Angle, Soften, Level, BPM), a choice (Profile, Rule, Blend), a colour (Colours by role), a switch (Solo, Mute, a
module's on/off), and, in the advanced chapter, values that move. Layering comes in several ways: a chain inside one
layer (source, warp, filter), where a layer plays, a new layer, how layers blend, and their order.

## The look the idea opens

What "the AI made" from the idea, preloaded (a tutorial JSON like the others, opened as an unsaved copy):

- **Rose** (plays on the rose window): Bars, rings moving out from the heart of the rose, soft-edged, the whole
  palette.
- **Arches** (plays on the main arches): Single strand, bands of colour running along each arch's wire, up one leg
  and over.
- Palette: Chapel (the default, magenta and violet), so the Colour chapter's palette change is a big, clear shift.

## 1. Getting around (practice look: one slow Colour wash on the whole Folly, so there is something to look at)

1. **Still being built** (read): Studio is in development; your name › Report a problem (or F8) tells us when
   something breaks.
2. **Turn the model** (drag the preview): the preview is the real rig, every LED where it hangs; drag to see it
   from another side.
3. **A view** (click Rose): the views put the camera on a part of the Folly in one click; the rose window is where
   our look starts.
4. **Zoom** (scroll on the preview): scroll to move in close to the rings.
5. **The whole Folly** (click Fit): Fit (or a double-click) frames everything again.
6. **Pause and play** (▶ or Space, twice): pause freezes a moment to study; play carries on.
7. **Ideas** (click Ideas in the header): a look usually starts as a sentence. Open Ideas.

## 2. From an idea (the Ideas page, then the preloaded look)

1. **Describe it** (type in the idea box): type "The rose window blooms open ring by ring while light runs up the
   main arches." The box is where any look starts; the more you say about colour, motion and place, the closer
   the first draft.
2. **Make it** (click Turn it into a look): normally a model writes the code, which takes a minute; in the tutorial
   the look opens at once, ready-made. Done when the Studio shows it.
3. **What it made** (click the Arches layer): each part of the look is a layer; the top one is Rose. Click Arches to
   see its settings on the right.
4. **See it close** (click Rose view): the camera on the rose window and the arches under it, where the next
   changes show.

## 3. Modules and colour (on the Arches layer, Rose view)

1. **A number** (Arches › Speed (LEDs a second): 20 → 8 or less): a module's settings are its controls. Slower
   bands are easier to follow round the curve of the arch.
2. **A choice** (Profile: Bands → Comet): each band becomes a bright head with a fading tail, so the light reads as
   running up the arch.
3. **A colour** (Colours: tick high): Colours picks from the look's palette by role; the brightest colours make the
   comets stand out against the rose.
4. **The Look tab** (open it): settings for the whole look, not one layer, are in the Look tab.
5. **The palette** (Chapel → Ocean): every colour comes from the palette. The rose and the arches turn to deep
   blues and teal at once.

## 4. Layers and chains (Rose view)

1. **Solo** (S on Rose): only that layer plays, so you can shape it without the rest.
2. **A filter** (+ Module › Filters › Stained glass): a chain runs top to bottom: the source draws, then each module
   changes what the ones above made; a filter reworks the light itself. Stained glass colours the rose's panes like
   a cathedral window.
3. **A filter's choice** (Rule: Petal → Spiral): the panes' colours now wind out from the heart in a spiral.
4. **On and off** (Stained glass off, then on): a module's switch skips it and keeps its settings, to compare.
5. **Solo off** (S on Rose again), then **Solo** (S on Arches): the next changes are on the arches.
6. **A warp** (+ Module › Warps › Rotate): a warp moves the light without changing its colour; it sits between the
   source and the filters. Rotate turns the comets' direction.
7. **A warp's number** (Angle: 0.125 → 0.25 or more): at a quarter turn the comets sweep across the arches instead
   of up them.
8. **Soften** (15 cm → 40 cm or more): soften blurs the layer at the end of its chain, so the comets' heads melt
   into a glow.
9. **Where it plays** (Plays on: tick the small arches): a layer lights only the groups it plays on; the comets now
   run on the small arches too.
10. **Solo off** (S on Arches again): back to the whole look.
11. **A preset** (+ Add › Presets › Starfield): a preset is a layer ready-made from modules; stars glint over a
    dark sky on the whole Folly.
12. **Inside a preset** (its Sparkle › How many: 0.5 → 0.9 or more): a preset's layer is a chain like any other, to
    tune; a sky full of stars.
13. **Level** (Starfield: 100 % → 50 % or less): level is how strongly a layer shows; at half it is a bed.
14. **Blend** (Add → Over): Over covers the layers below instead of adding to them, so the arches fade under it.
15. **Order** (↓, to the bottom): what is lower is covered; the stars go under, and the rose and the arches are back
    on top.
16. **Mute** (M on Starfield, then again): mute silences a layer without removing it, to see the look without it.

## 5. Time (whole look, Fit)

1. **The tempo** (Timeline › BPM: none → 90): BPM is the tempo everything on the beat follows.
2. **On the beat** (the clock beside Arches › Speed): the clock counts the speed in beats instead of seconds, so
   the comets land on the tempo.
3. **A clip** (Arches › + Clip): a clip plays a layer for part of the look; the arches now come in after the rose
   has opened.

## 6. Values that move (advanced; Rose view)

∿ on a value hands it to something that moves it: an LFO (a wave), a macro (one fader), the beat. These take a
little more to picture, so they are last.

Three LFO shapes on three kinds of value (a brightness, a filter's amount, a warp's angle), then one macro moving
two values (a tail's length, a ring count), then the timeline moving the macro.

1. **An LFO** (Starfield › Colour wash › the ∿ beside Brightness › LFO): ∿ hands a value to something that moves it;
   an LFO is a wave, so the sky dims and brightens by itself.
2. **Its rate** (Rate: 4 beats → 16 or more, or 4 bars): with a tempo it counts beats; at 90 BPM the sky breathes once every 10 seconds or more.
3. **Its range** (Between: To 0.45 → 0.8 or more): where the wave goes; the sky swells bright and sinks dark.
4. **A square wave** (Rose › Stained glass › Amount's ∿ › LFO › Square): a square wave jumps between its ends.
5. **All the way off** (Between: From 0.75 → 0): the rose flips between plain rings and stained glass.
6. **A saw wave** (Arches › Rotate › Angle's ∿ › LFO › Saw): a saw climbs and drops back; the comets' direction turns,
   then snaps back.
7. **A macro** (Look tab › + Macro): one fader that can move several values together, by hand, from the timeline or
   from Live.
8. **Tie a value** (Arches › Single strand › Comet tail's ∿ › Macro › macro1): the fader sets the comets' tails.
9. **Tie another** (Rose › Bars › Bars across's ∿ › Macro › macro1): one fader sets tails and rings together.
10. **Move the fader** (macro1: 0.5 → 1): long tails and many rings at once.
11. **Automation** (Timeline › + Automate… › macro1, two points: low early, high late): the look builds as it plays.

## 7. Keep it

1. **Try an idea** (Arches › Plays on: tick the whole building): every edit is kept in History, so trying is safe;
   comets everywhere drown the rose.
2. **Undo** (History › Undo, or Ctrl+Z, until they are back on the arches): any step back is one click.
3. **Save**: keeps "Rose and arches" in My looks as your own; the practice copy changed nothing of yours.
4. **Live**: what the Folly plays now, and what is lined up next. Open it.

## Around the steps

- **Seeing each change.** The chapters on the rose and the arches open on the Rose view (a practice look's `view`);
  whole-look steps on Fit. The bars-on-spires dots
  are gone with the spires: the arches and the rose are dense, so bands and comets read as lines. Each changed
  step gets a shot at 1366 × 768 for approval.
- **The idea step.** While "Make it" is open, the Ideas page's Turn it into a look opens the tutorial's look instead
  of asking a model (nothing is sent; it works on a locked account too). On the Pi, which has no Ideas, chapter 2
  opens the look directly.
- **Kept from before:** the preview is never dimmed and the step card stays off it; each control is scrolled into
  view and ringed; no step counts or minutes; the e2e plays every chapter at 1366 × 768 and 1366 × 660.
