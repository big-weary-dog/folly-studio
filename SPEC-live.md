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

With `PI_PREVIEW_URL` set (docs/HOSTING.md "The Pi's page"), the stage can follow that dry-run engine: the last to use
a control drives. A control used on `/pi` (play, set, tap, level, blackout, as the proxy passes it) makes `driver`
`pi`; a controller's next accepted `play` or `set` makes it `stage` again. Each change goes to every socket as a whole
`state`. `/pi`'s page gets `{ type: 'driver', from: 'pi' | 'live' }` from the proxy after the Pi's hello and at each
change; the Pi alone never sends it.

The server holds one socket to the engine's `/pi/ws` (from 127.0.0.1, its own origin; reconnecting after 1 s,
doubling to 10 s), and while `pi` drives sends on what it says (`shared/schemas/live.ts`):
- `source: { rev, id, title, duration, bpm?, globals, automation, layers }`: what plays, its modules by library `ref`
  with no code (each viewer has our library). On joining, at a switch, and when a push takes a name off its lane
  (`rev` moves: the engine's look is prepared again).
- `now: { rev, t, bpm, beat0, offset, values, gain }` at server time `at`: show time t, the tempo, downbeat and look
  clock's offset (0: pattern time is show time), the values of the look's live controls, and the output's gain (master × blackout × a switch's dip,
  as eased). Sent when anything but t changed, else every 2 s; null while the engine is down.

A viewer plays `source` (fresh clock) and sets `now`'s values, tempo and clock in place before a frame (the sandbox's
`frame.set`), as the engine sets them, so clocks bound to them run on as the engine's do; the view's gain is `gain`.
Show time is `t + (server now − at)`, wrapped by the duration, anchored once and moved only when it slips past 100 ms,
so frames never step back. A viewer that sets each frame's values renders the engine's bytes
(`pi/test/follow.test.ts`); at 10 a second, frames match while nothing moves, and a viewer joining mid-loop has its
bound clocks from its own start until the loop wraps. The flash guard's dip to `safe` is a switch like any other.

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
