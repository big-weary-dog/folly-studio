# Folly Studio — the live play controller (part of the contract)

How people drive the lights on the Pi: two modes the admin picks, the engine's rules for each, and the one page that
shows both. It builds on SPEC-offline "Playing on the lights" (the engine's queue). The engine's messages are
`pi/src/protocol.ts`; the page is `pi/page/` (the engine's own `/pi/`), used again by Studio's `/live` on the Pi.

## Modes

`mode` is `jukebox` or `live`, for the whole installation:

- **Jukebox**: the queue alone. Curators and admins add a look to the end or next, move or remove queued ones, and
  **Fade to next**. Every change the lights make is a full fade (`FADE.queue`, 1 s each way) at the end of a look or
  on Fade to next. No Play now, no knobs, no Master, no tempo and no Blackout.
- **Live Play**: everything in Jukebox, plus the playing look's knobs, Master, tap tempo, Blackout, and a cued
  change with a chosen fade. Driving is for whoever may control the live stage (`STUDIO_LIVE_CONTROL`, SPEC-live
  "Settings"); others who may open `/pi` watch.

The admin sets it in **Admin → Light** (`PUT /api/admin/lights { liveLooks, mode }`, kept in `lights.json`, default
`jukebox`). Studio's feed tells the engine (`{ type: 'mode', mode }` after its hello and at each change), and the
engine refuses what the mode does not allow, whatever a page sends. The engine alone starts in its `mode` setting
(`--mode`, default `jukebox`). Entering Jukebox: held knobs glide back to the look's own values, the palette blends
back, the tempo returns to the look's, Master glides to 100 % and a blackout lifts (fading in), so nothing is left
that Jukebox has no control for.

## People

Behind Studio's proxy each page's `hello` carries `who: { name, drive }`, set by the proxy from the session (the
page's own is dropped): the username, and whether they may drive Live Play. The engine's own page on the LAN has no
`who`: its PIN is its only gate, and it drives as "the Pi's page". The feed's hello has none either.

- **The driver.** In Live Play one person has the knobs (`set`, `release`, `palette`, `level`, `tap`): the first
  to move one when nobody has them, or whoever sends `{ type: 'take' }`. Anyone else's knob message is refused
  ("cara has the knobs: Take over first"). The knobs are free again when the driver's last socket closes; never on
  idle. Playing a look now (`play`, `queue` or `send` at `now`) and Blackout are for anyone who may drive; the
  queue's other edits are for anyone who may open `/pi`, as in Jukebox.
- **Here.** The state names the people with a page open (`here`, each once), so the page can say who else watches.
- **You.** The engine's hello answer says who this page is, `you: { name, drive }` (the Pi's own page: "the Pi's
  page", driving; none for the feed), so it can say "You're driving" or offer **Take over**.

## The engine's state, as this adds to it

```jsonc
{ mode: 'jukebox' | 'live',
  driver: { name, ago } | null,         // who has the knobs; ago: seconds since they last moved one
  here: ['cara', 'jo'],
  blackout: { on, by: name | null, ago },   // who turned it on or off last, and how long ago (seconds)
  queue: [{ key, id, title, kind, by?, duration: s | null }],   // duration: what it plays (a bake not read yet: null)
  looks: [{ id, title, playable, error?, duration }],              // the engine's own; duration: seconds of a play
  look: { …, controls: [Control] } }
Control = { name, kind: 'macro' | 'bpm' | 'palette', min, max, value, default, held }
```

`default` is the look's own value (a palette: its name, `''` for a palette of the look's own that is not one of
`data/palettes.json`'s); `held`: a person moved it since the look began, and it has not been released. A palette
control's `value` is a name (`''`: the look's own); `min` and `max` are 0.

## Messages the page sends, as this adds to them

| Message | What | Jukebox |
|---|---|---|
| `{ type: 'next', fade? }` | skip to the next queued look (and go on from a flash-guard pause) | yes, at 1 s |
| `{ type: 'queue', id, at?, fade? }`, `play { id, fade? }` | as before; `fade` for `at: 'now'` and `play` | not `now`, no `play` |
| `{ type: 'set', name, value }`, `{ type: 'release', name }` | a knob, or let one go: it glides to `default` | refused |
| `{ type: 'palette', name }` | blend to that palette (`''`: the look's own) | refused |
| `level`, `tap`, `blackout` | as before | refused |
| `{ type: 'take' }` | take the knobs | refused |

`fade` is seconds, 0.25–8: the playing look fades out over it and the next in over it. Without it, `FADE.queue`.
Studio's `send` takes `fade` too, and a baked item's `duration`. `resume` is gone: `next` goes on from a pause.
Only Studio's feed sends `mode` and `send`; the proxy passes pages neither.

`POST /api/lights/queue { lookId, at?, fade? }` refuses `at: 'now'` in Jukebox (409, "The lights are in Jukebox:
Play next or Add to the end").

## The palette knob

Every live look (not a bake) offers `palette` as its last control: the look's own palette, then
`data/palettes.json`'s, by name. A change blends over `BLEND` (2 s): each role's colours move to the new ones in
OKLab (`fadeInto`), in one palette held in place, so picks walk the blend without being resolved again each frame.
A change mid-blend starts from the colours showing. A new look starts in its own palette.

## The page

One skeleton at every size, top to bottom, and nothing scrolls at 390 × 844 (on a laptop, 1024 px wide or more, the
now card and the queue on the left, the mode's surface and the show row in the middle, and the stage and Blackout
on the right):

1. **Status strip** (52 px): the mode chip (sand "Jukebox", cobalt "Live Play"), the link as a shape and a word
   (● On the lights, ■ Blacked out, ▲ Reconnecting), and who drives and who is here.
2. **Now card**: "On the lights now", the title on one line, a bar with "1:12 left" and "of 2:30", and what is next.
3. **The mode's surface**, taking the height left:
   - Jukebox: the queue (56 px rows, numbered, "in 1:12", ↑ and ×; past what fits, "N more" pages) and **Add a
     look**: a search, sources (Mine · Gallery · The lights' own in Studio, from `GET /api/lights/looks`; the
     lights' own alone on `/pi/`), tiles 6 a page (9 on a laptop), a look that cannot play shown dashed with why
     ("Custom code: needs a bake"). Picking one opens its **preview**, a modal: the look's gallery preview playing
     (SPEC-previews: its 5 s that move the most; its still under reduced motion; the card's glass when it
     has none, as the lights' own looks never do), who made it, how long and how it plays, then **Play next** and
     **Add to the end** (× or Esc closes it).
   - Live Play: the bank (below); the now card's **Up next** turns it to the queue, with Add a look, and back.
     Picking a look opens the same preview, with **Cue it**, which **cues** it: "Cued · not on the lights yet",
     Crossfade 1 s · 4 s · 8 s (4 s first), then **Fade to … · 4 s**, **Play next instead** or **Cancel**. Nothing
     changes until the commit.
4. **Show row** (Live Play only): Master (a horizontal fader) and Tap with the BPM and ± 1. A bake's tempo is fixed:
   Tap is dashed, "Tempo fixed by the bake".
5. **Blackout bar** (Live Play only, 56 px), always last: press and hold 0.5 s (B on a keyboard). It fills left to
   right; letting go cancels; "Keep holding: the lights go dark in 0.2 s". Bringing the lights back is a hold too.

**The bank** is 4 strips of one size. The look's own controls, in its order (`bpm` is Tap, never a strip), page by 4
("5–8 of 9"); ‹ › are always there, dashed at the ends; empty slots are dashed, "not offered". A number strip is a
vertical fader with its value below; held, it turns amber and its value becomes "↺ 0.80", which releases it. The
palette strip shows 4 palettes with their colours, the pick outlined with ✓, "More ›" for the next 4, and "a change
blends". Names clamp to 2 lines; the full name is the strip's label. A look with none: the bank says why (a bake:
"its colours and tempo were fixed when it was baked"), that Master and Blackout still work, and what the next one
offers. On a laptop the bank has "Reset these 4".

**States.** Each has a shape and a word as well as a colour:

- Blacked out: a 4 px ruby frame, "Blacked out" in the strip, the bank replaced by "The lights are dark" with who
  and how long ago, the queue playing on unseen, Master as "Master, when back".
- Flash guard (`tripped`, `paused`): an amber ▲ banner naming the look it caught, that the safe look is on and the
  queue waits, and "Go on with <next>" (`next`).
- Lost link: an amber banner, "Can't reach the lights. They play on as they were", a retry countdown and **Try now**;
  the now card and knobs hatched as last known; Blackout dashed, naming the way on site: the Pi's own page (`/pi/`),
  or switching the ops hub back to FPP (pi/INSTALL.md).
- Watching: someone else has the knobs: they are dashed and locked and move as that person moves them; "cara has the
  knobs. Last touched 0:04 ago" and **Take over**. Blackout stays live for anyone who may drive.

Targets are at least 44 px, primary actions 56 px. Text is `#f3e9da` or `#cfbfae` on the night colours; dark text on
sand, amber and ruby. Disabled controls are dashed, never faded.
