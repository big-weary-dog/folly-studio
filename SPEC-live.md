# Folly Studio — the live stage (part of the contract)

One shared stage: every viewer of `/live` sees the same look at the same show time with the same values, and
controllers on `/live/control` change it. `shared/schemas/live.ts` holds these shapes; `src/live/` the server side;
`public/js/ui/live/` the pages.

## Settings

| Env | Values | Default |
|---|---|---|
| `STUDIO_LIVE_CONTROL` | `curators` (curators and admins), `admins`, `members` (anyone signed in) | `curators` |
| `STUDIO_LIVE_LOOKS` | `reviewed` (curator-approved, so bake- and flash-checked), `shared` (any shared look) | `reviewed` |

Watching needs a session, as every page does.

## State

```jsonc
live = { rev: 12,                       // +1 each change
  look: { id, title, ownerName, layers, duration, bpm?, globals?, automation? } | null,   // copied at switch
  startedAt: 1760000000000,             // server epoch ms of show time 0; a switch restarts it
  loop: 3,                              // the loop the lanes are for
  held: { energy: 0.8, storm: 0.2 },    // overridden macros: their value when the loop began
  lanes: { energy: [[0, 0.5], [4.21, 0.5], [4.26, 0.8]] },   // this loop's live automation (show time, value)
  drop: ['storm'],                      // released: back to the look's own value from the next loop
  layers: { l1: { level: 0.4, muted: false } }, blackout: false,
  by: { id, username } | null, updatedAt,
  driver: 'stage' }                     // or 'pi': the stage follows /pi's engine (below)
```

**Time.** Show time `τ = (server now − startedAt) / 1000`; `loop = ⌊τ / duration⌋`; the frame asked of the sandbox
is `t = τ − loop × duration`. A viewer's server clock is its own plus the offset its pings measured. The server's
"now" is its wall clock at boot plus monotonic time (`src/clock.ts`), so a host whose wall clock steps never jumps the
stage.

**Pushes are automation.** A push of value `v` for global or macro `name` arrives at server time `at`
(+ a 30 ms lead, so viewers usually have it before it plays). In the loop's lane (made, at the first push, from
the look's own lane up to `at`, or `[[0, held or the look's value]]`) the server adds `[at, the lane's value then]`
unless a point is within 50 ms, then `[at + 0.05, v]`, a 50 ms ramp; a push within 50 ms of the last point moves
that point instead. Times are kept to the ms; values held to the macro's range. A lane holds at most
256 points (the core's limit); past that a push moves its last point. Because integrated clocks are
integrals of lanes, everyone, and anyone joining late, computes the same frame for the same `t`, and nothing jumps.
**Rolling over.** When `t`'s loop passes `live.loop`, every side does the same: each lane's last value becomes
`held`, names in `drop` leave `held`, lanes and drop empty, `loop` = the new loop. The server rolls before applying
a push; a viewer rolls as its clock passes.
**What the sandbox gets.** The look's layers (each level × the live level, 0 if muted), its globals, and its
automation with, for each name in `held`, `lanes[name] ?? [[0, held[name]]]` instead; `clock: 'fresh'`.
Blackout is the view's gain (0), not the look. Layers and blackout change at `at` on each viewer.

## Socket: `GET /api/live/socket` (WebSocket)

Needs a session (401 before the upgrade) and a same-origin `Origin` (403). JSON text frames.

| client → server | server → client |
|---|---|
| `{ type: 'ping', id }` | `{ type: 'pong', id, now }` (server epoch ms) |
| `{ type: 'sync' }` | `{ type: 'state', live, now, control }` (on connect, a switch, a sync; `control`: may this person) |
| controllers: `{ type: 'set', values?: { <name>: n }, release?: [name], layers?: { <id>: { level?, muted? } }, blackout? }` | `{ type: 'update', rev, at, loop, held, drop, lanes: { <name>: points \| null }, layers?, blackout?, by }` (changed lanes only; null: gone) |
| controllers: `{ type: 'play', lookId }` | `{ type: 'presence', viewers, controllers: [username] }` (controllers: pushed in the last 30 s) |
| | `{ type: 'pi', at, now, source? }` (while `driver` is `pi`: below) |
| | `{ type: 'error', error }` (refused; the socket stays open) |

An update whose `rev` is not the viewer's + 1 makes it ask `sync`. Limits per socket: 30 messages a second (a
burst of 60; past it messages are dropped with one error); a switch every 2 s; past 4 × the rate for 2 s the socket
is closed (1008). At most 200 sockets (1013 past it). The server pings every 25 s (Cloudflare closes idle sockets at
100 s). Clients reconnect after 0.5 s, doubling to 8 s, with jitter, for good, and get the whole state again. Until a
state comes, the pages say so: after 10 s "Can't reach the stage. Retrying…", and after a close with 1013 "The stage
is full. Retrying…".
`set` names only the look's macros; `layers` only its layer ids.

## Following /pi

With `PI_PREVIEW_URL` set (SPEC-offline "The Pi preview"), the stage can follow that engine: the last to use
a control drives. A control used on `/pi` (play, set, tap, level, blackout, as the proxy passes it) makes `driver`
`pi`; a controller's next accepted `play` or `set` makes it `stage` again. Each change goes to every socket as a whole
`state`. `/pi`'s page gets `{ type: 'driver', from: 'pi' | 'live' }` from the proxy after the Pi's hello and at each
change; the Pi alone never sends it.

The server holds one socket to the engine's `/pi/ws` (from 127.0.0.1, its own origin; reconnecting after 1 s,
doubling to 10 s; its hello says `feed: true`, so a dry run idles while it alone is open), and while `pi` drives
sends on what it says (`shared/schemas/live.ts`):
- `source: { rev, id, title, duration, bpm?, globals, automation, layers }`: what plays, its modules by library `ref`
  with no code (each viewer has our library). On joining, at a switch, and when a push takes a name off its lane
  (`rev` moves: the engine's look is prepared again).
- `now: { rev, t, bpm, beat0, offset, paces?, values, gain, queue? }` at server time `at`: show time t, the tempo,
  downbeat and look clock's offset (0: pattern time is show time), the paces' offsets, the values of the look's live
  controls, the output's gain (master × blackout × a switch's dip, as eased), and what is queued after it (SPEC-offline
  "Playing on the lights"). Sent when anything but t changed, else every 2 s; null while the engine is down.

A viewer plays `source` (fresh clock) and sets `now`'s values, tempo and clock in place before a frame (the sandbox's
`frame.set`), as the engine sets them, so clocks bound to them run on as the engine's do; the view's gain is `gain`.
Show time is `t + (server now − at)`, wrapped by the duration, anchored once and moved only when it slips past 100 ms,
so frames never step back. A viewer that sets each frame's values renders the engine's bytes
(`pi/test/follow.test.ts`); at 10 a second, frames match while nothing moves, and a viewer joining mid-loop has its
bound clocks from its own start until the loop wraps. The flash guard's dip to `safe` is a switch like any other.

## Relay to the lights

An option beside the engine's own render: a laptop's browser renders what the engine plays and the engine plays its
frames. The engine keeps the whole output path for every relayed frame: the master, blackout and fades, the flash
guard (a relayed strobe dips to `safe` as a local one does), `ledChannels` with its light settings, the rose and the
power compressor. Only `renderFrame` is skipped; the look's live controls still step, so the state reads the same.

**The lease.** One sender at a time, on the engine's socket (`pi/src/protocol.ts`, `pi/src/relay.ts`):
- `{ type: 'relay-start', over? }` from a socket whose hello passed (the PIN, if set) and that may drive (a page's person
  with `drive`, or the Pi's own page; never Studio's feed). The first holds it; any other gets `{ type: 'relay',
  holding: false, error: '<who> is relaying to the lights.' }`. The holder gets `{ type: 'relay', holding: true }`.
- It ends at `{ type: 'relay-stop' }`, at the socket's close, or after 1 s with no frame in; the holder is told
  `{ type: 'relay', holding: false, error? }`.
- `over: true` (Studio's editor, below): its frames are not the engine's look but play over whatever it has, rev 0
  on every frame. A switch of the engine's look does not stop them, and the flash guard tripping on them ends the
  lease (`error: 'The flash guard tripped: the lights play their own.'`), so the dip to `safe` holds: an `over`
  start is refused while it does, until a look is picked.

**The frame.** A binary message, little-endian: u32 slot index, u32 look rev, then `count × 3` Uint16 rgb (the rig's
cells in its order, 0..65535 for 0..1, before any light transform: what `renderFrame` gives). Exactly
`8 + count × 6` bytes, or it is dropped; from any socket but the holder's it is dropped with an error. A relayed frame
is data: its length is checked and its values are 0..65535 by construction. At most 4 × fps frames a second are
taken (a burst of 128).

**Slots and the buffer.** The engine counts its frame slots: one per tick of its 40 fps timer, and one per frame it
skips, so slot `n` plays at the timer's start + n / fps. The state's `relay` says where it is (below). The engine
keeps 128 slots, keyed by index: a frame for a slot already played, or more than 127 ahead, is dropped. The sender
renders ahead of the slot playing by its buffer: 200 ms (8 frames) by default, 80, 400 or 800 ms at the sender's
choice. A look is fixed-step and deterministic in show time, so rendering ahead costs nothing while it plays on
its own; a knob push lands when its frame plays, one buffer later.

**Show time.** Slot `s` plays the look's frame `f = round(look.t × fps) + (s − relay.next)`, both from one state,
wrapped as the engine wraps: past the duration, back by whole loops of `round(duration × fps)` frames, `beat0` back
by as much. A frame's rev is the state's `look.rev`;
one for another rev is not played (unless the lease is `over`).

**Starvation.** The engine notices a late frame by its slot, not by the socket (a Wi-Fi drop sends no FIN):
- On the first slot with no frame for it, it holds the last relayed frame, for up to 100 ms (4 slots).
- Past that, it dips through black (0.1 s) to its own render, and fades that back in.
- It goes back to relayed frames, with no dip (they are the same look at the same time), on the first frame after
  a `relay-start`, after a switch (a new rev starts on its own render: the old look's frame is never held into the
  new), or after 1 s of steady frames (40 in a row), never mid-flap.
- A baked look plays its bake: there is nothing to relay.

**State.** `PiState.relay`: `{ by, on, index, next, ahead, misses, frames }` or null with no lease: `by` the holder's
name (`the Pi's page` for its own), `on` relayed frames are playing now, `index` the slot playing (fractional: how
far into it the state was read), `next` the slot `look.t` is for, `ahead` frames held for the slots after it, `misses` slots with no frame since the
lease began, `frames` relayed frames played.

**Studio's side.** The Live tab, for those who may open `/pi` (admins, and curators on the Pi), shows **Relay to the
lights**. Turned on, the page opens its own socket to `/pi/ws`, takes the lease, and runs a sandbox of its own: the
look the engine plays (its `source`, code from our library by ref) on a fresh clock. The Worker renders ahead on its
own timer, at the engine's slots (a hidden tab throttles the page's timers, not a Worker's, and not messages), sets
each frame's values as the state has them (`js/live-set.ts`), quantises to Uint16 and posts the frame; the page
sends it. The page estimates the slot playing from the states: the newest reading of `relay.index`, run on at fps on
its own clock, taking the furthest ahead of the last 10 s's readings (each reaches it late, never early). It takes
a Screen Wake Lock while relaying, and says so, the buffer (`ahead` in ms), the misses, and who holds the lease.
A frame the socket cannot take (over 256 KB waiting) is dropped, not queued.

**From Studio's editor.** The editor's preview, for the same people, has **To the lights** in its transport: the
same switch, buffer and status, the same socket, lease and PIN, with `over: true`. The look being edited goes to the
lights as it stands, custom code and unsaved edits included: its code still runs only in the browser's sandbox, and
the engine sees frames, guarded as any. The preview's own sandbox renders ahead (the Worker that holds the edited
look), so an edit plays within the buffer. Show time is the editor's clock: the page tells the Worker the playhead
(`clock: { t, at, speed, playing, duration }`: show time `t` at epoch ms `at`), anew when it plays, pauses, seeks,
changes speed or the duration; slot `s` plays `t + (its epoch time − at) × speed`, wrapped by the duration, or `t`
while paused. A hidden tab's preview stops drawing, but the Worker renders on, and coming back the playhead catches
up with the lights.

Studio's `/pi` proxy passes binary frames only from a socket the engine last told `holding: true`, each exactly
`8 + count × 6` bytes (the rig's count): one of another size closes the socket (1008), and one sent before the page
heard its lease end is dropped. The server's socket limit is 32 KB, a Folly-rig frame's; the stage's own messages
stay at 16 KB.

**Measured on the playa (pi/INSTALL.md "Relay: measuring it on site").** Ping jitter over the site's Wi-Fi sets the
buffer: p99 plus two frames.

## HTTP

```
GET /api/live          → { live, now, control }
GET /api/live/looks    → { looks: [listed] }   what a controller may play (STUDIO_LIVE_LOOKS); 403 otherwise
```

The live state is kept in `<data>/live.json`, written a second after a change and at shutdown (whole, to a temporary
renamed over it), so a restart plays on. At start it is read back through `SavedLive` (`shared/schemas/live.ts`): a
file from before a field was added takes that field's default; one that is not a stage's state is logged and the
stage starts empty.

## Pages

- `/live`: the Playa view of the stage, the look's title, who is controlling, the sync (clock ± ms, fps: for admins,
  or with `?stats`). On a touch screen it starts on the Low tier. Pattern code runs only in the viewer's own sandbox.
- `/live/control`: for controllers. Pick a look; Blackout; a fader for each macro (its min..max), each with ↺ to release it; per layer a level fader and a mute pad.
  Faders send at most 20 times a second while dragged, and the final value on release. Built from the look's data;
  module params are not offered yet.
- On the Pi, curators' `/live` is the live play controller instead (SPEC-liveplay).

## Known gaps

- **Pushed values can make a reviewed look flash; `/live` has no flash guard yet.** Reviewed looks passed the bake's
  flash check at review, with the values they were saved with.
- **Stateful patterns drift** between viewers (DESIGN §14): `frame()` state depends on the frames each computed.
- A look edited after it was switched to keeps playing as it was copied.

## Later: the real Folly

A long-running render box (bubblewrap, a stdlib-only realm, as bakes) subscribes to this state as one more viewer
with offset 0, renders fixed-step at the rig's fps (so no stateful drift on the sculpture), hands back channel bytes
as data; the server applies blackout and the flash check (`FlashWatch`) and sends E1.31 with `tools/sacn-play.ts`'s
packet code. Not built.
