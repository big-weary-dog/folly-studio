# Live play: the page against the mockups

Each mockup board (claude.ai/artifact/XzQYoegZHdAwpK1zyq5ixQ: Jukebox, Live Play, States) beside what the page
draws at a phone's 390×844 and a laptop's 1366×768, `<Board>-<width>.png`. Shot in headless Chromium from the dry-run
engine (`npm run pi -- --dry-run`) with fixture looks of the boards' titles and knob counts; LiveNone (a bake) and
StateWatching (cara on the knobs) rewrite the engine's state on its way to the page, since a bake and a second driver
need Studio. None of them scrolls.

| Board | 390 | 1366 |
| --- | --- | --- |
| Main (Jukebox) | `Main-390` | `JukeboxLaptop-1366` |
| JukeboxAdd | `JukeboxAdd-390` | `JukeboxAdd-1366` |
| JukeboxLaptop | `Main-390` | `JukeboxLaptop-1366` |
| LiveFour | `LiveFour-390` | `LiveLaptop-1366` |
| LiveNine (the second bank) | `LiveNine-390` | `LiveNine-1366` |
| LiveNone | `LiveNone-390` | `LiveNone-1366` |
| LiveStaging (a cue) | `LiveStaging-390` | `LiveStaging-1366` |
| LiveLaptop | `LiveFour-390` | `LiveLaptop-1366` |
| StateArming | `StateArming-390` | `StateArming-1366` |
| StateBlackout | `StateBlackout-390` | `StateBlackout-1366` |
| StateWatching | `StateWatching-390` | `StateWatching-1366` |
| StateFlash | `StateFlash-390` | `StateFlash-1366` |
| StateLost | `StateLost-390` | `StateLost-1366` |

Where the page departs from the boards, SPEC-liveplay wins: Jukebox has no Blackout bar or show row (Main and
JukeboxLaptop draw one), and there are number and palette strips only.

`chrome-live-phone`, `chrome-arming-phone` and `chrome-blackout-phone` are the proof in real Windows Chrome 155,
headed, on the phone layout: a held knob, a palette picked, the hold filling, then blacked out.
`studio/` is Studio's `/live` on the Pi for a curator in both modes (`LIGHTS_SHOTS=… npm run smoke -- jukebox.spec.js`).
