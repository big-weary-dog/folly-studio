# Folly Studio — bug reports (part of the contract)

F8 on any page (or "Report a problem" in the user menu, for phones) files a report. The press freezes the moment:
the page's state is read first, the 3D view's next frame is kept as a JPEG (≤ 960 px wide, quality 0.8), then
everything pauses (the preview's loop and the 3D view; on /live, the socket's updates are held) until the form
closes, when it all resumes as it was. The form asks "What went wrong?" (Enter sends, Shift+Enter is a new line,
Esc cancels) with "Include screenshot" on.

`report = { format: 1, at, note, build, page: { path, title, viewport: [w, h, dpr], userAgent, gl }, toasts,
errors, dialogs, sources: { studio?, live? }, screenshot? }`: `toasts` the last 50, `errors` the page's last 100
(window errors, unhandled rejections, console.error); `sources.studio` the look (id, title, `draft`: the unsaved
look as save() sends it, `dirty`), the selection, picked modules, mute and solo, the layout, the timeline's
selection and zoom, the clock (`t`, playing, speed, baked), the preview (view, mode, tier, quality, venue, dimmed,
flashing, stats), the heavy layers, the problem shown and each layer's status, and the library and rig by name and
size; `sources.live` the stage's rev, driver, look and blackout. A reader that throws gives `{ unreadable }`; each
piece is cut at 64,000 characters. Everything is scrubbed (`public/js/scrub.ts`): keys naming secrets blanked, IPs
masked, URLs without query or fragment; the path has no query or hash; no cookies.

The server stores `<STUDIO_DATA>/reports/<stamp>-<id>/report.json` (adding `server: { user: { id, username },
build, logs }`, its last warn and error lines) and `shot.jpg`, keeping the newest 500 within 500 MB and none older
than 60 days. Admins read them on Admin's Reports tab; "Open as captured" opens `/studio?report=<id>`: the captured
draft in an unsaved editor, at the captured time, view, quality, selection and layout, paused, so a browser run
reproduces it. `node tools/reports.ts list | get <id>` reads them from `STUDIO_DATA` directly.
