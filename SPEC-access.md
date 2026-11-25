# Folly Studio — accounts and access (part of the contract)

Who has an account, what each role may do, and the Admin pages. `src/auth.ts` holds accounts and sessions.

## Accounts

`user = { id, username, role: 'member' | 'curator' | 'admin' }` (curators listed in `STUDIO_CURATORS`, admins in
`STUDIO_ADMINS`, or made so on People below, whichever is higher; an admin is also a curator), and `tour?` once they have met the tutorial (SPEC-tutorial):
`tour = { seen: true, done: [path], at?: { path, step } }`, the paths finished and where one was left. An account
without it has not seen the tutorial. Signing up or in is limited per client address (100 a minute) and, for
failures, per address and username (10 a minute): 429 with `Retry-After`. Password hashes run 3 at once with 30
waiting; past that, 429 "busy". A route that needs a session is 401 without one; the app takes a 401 from anything
but `/api/me`, `/api/login`, `/api/signup` and `/api/guest` as the session ending, and goes back to sign-in.

**Guests.** The sign-in page also lets anyone in as a guest with only a name (`POST /api/guest { name }`: 1–24
letters, digits, spaces and `_ . ' -`, trimmed; 10 a minute per client address, beside the sign-in limits). A guest
is a session, not an account: nothing is written to the users, and `user = { id: 'guest-…', username: <name>, role:
'member', guest: true }` whatever the name says (a guest named for an admin is no admin). The cookie lets them back in
on that device for 7 days; at most 1,000 guest sessions live at once, the oldest dropped first (anyone can
make one). A guest only reads: every mutating route but `/api/logout`, `/api/login`, `/api/signup`
and `/api/guest` is 403 "Guests can't save", so they make no looks, bakes, reports or tour. The Studio keeps a
guest's work in that browser
(localStorage, the Studio's look as saved, written as it changes) and opens it again on `/studio`; Save asks them to
log in or sign up, since saving is for accounts, and the work comes along: the first account to open a blank Studio
in that browser gets it, unsaved, and the browser's copy goes once that account saves or discards it. Their name
shows with a Guest tag; it is untrusted text, shown only as text.

## Your account

**Account** (`/account`, in the user menu; no guest has one) changes the password and deletes the account. There is
no email, so a forgotten password cannot be reset or recovered: Account and sign-up say so plainly.

- **Changing the password** takes the current one and a new one (sign-up's rules). It ends the account's other
  sessions; this one stays.
- **Deleting the account** takes its password and a confirm saying how many looks go, and how many are shared. It
  deletes the account, its sessions, and every look it owns: shared ones leave the gallery too, with
  their frames and previews. A copy someone else saved of one is theirs and stays. The browser is signed out, on
  sign-in. The username is free again.
- A change or a deletion whose password changed, or whose session ended, while it was checked is 409: of two at once,
  one stands.
- A wrong password is 403 "That is not your password.". Wrong ones are limited as failed sign-ins are, 10 a minute per
  address and account, then 429 with `Retry-After`.

## Who may do what

A look is its owner's: only they edit it, and others see it only when it is shared and approved (Moderation below);
curators see every shared look. Only they delete it, but for an
admin, who may delete any shared look: Delete on its gallery card and in the Studio's gallery notice, after a confirm
naming the look and its owner. Asking for what a look does not allow them, anyone else is told it is not found
(404), shared or not, so an unshared or unapproved look is never revealed.
A curator may also mark a look they can see reviewed (from the gallery, Approve), hide it, and bake it; admins are curators too, and alone use the Admin
pages and their `/api/admin` routes (403 for anyone else; each such route names its role, or the server does not
start).

## Moderation

A shared look is **approved** when a curator has marked it reviewed (SPEC "Baked frames") and no curator has hidden
it. Only approved looks are in the gallery and open for anyone but their owner and curators; the rest are 404 to
them, frames and previews too. A change to the frames clears the review, so an edited look waits for review again.
A curator **hides** a shared look from its gallery card (Hide; Unhide brings it back): `hidden` stays on the look
through edits and through unsharing and sharing again, until a curator unhides it, and the look is approved again
only when it is also reviewed. My looks tags its owner's shared looks that are waiting for review or hidden.
Anyone with an account may **Report this look** on a card someone else shared: a short note, sent as a report
(SPEC "Bug reports") that names the look, for an admin to read.

## Admin

Phone Admin keeps quick operator tasks; see [SPEC-studio "Phones"](SPEC-studio.md#phones).

Admins' header has one more item, **Admin** (`/admin`, which opens its first tab), where everyone else's has none.
Its tabs are pages of their own: Light (`/admin/light`, SPEC "Light and output"), Baking (`/admin/baking`,
SPEC-baking "The bake setting"), People (`/admin/people`, People below), Reports (`/admin/reports`, SPEC "Bug
reports") and Stats (`/admin/stats`, Stats below). `/light` and `/reports` lead to their tab, query kept; `/models`, `/access`, `/admin/models` and
`/admin/access` lead to Light. Anyone else who opens one sees an explanation that Admin pages require an admin
account, without the page's controls.
The browser uses the same admin permission as the server; admin API calls remain refused (403).
Leaving a Light draft asks before discarding it, including switching Admin tabs.
Light downloads the saved settings; while a draft differs, download waits for Save or Revert.

## People

People lists every account, newest first: its name, role, when it was made, how many looks it has and how many are
shared, and whether it is disabled; a search narrows it by name.
`account = { id, username, role, serverRole?, createdAt, looks, shared, disabled }`, `serverRole` the role
`STUDIO_ADMINS` or `STUDIO_CURATORS` gives it.

- **Role**: member, curator or admin, kept with the account. The server's lists still count: an account they name
  is at least that role, and People offers nothing lower (409 if asked).
- **Disable**: the account's sessions end and it cannot sign in ("This account is disabled.", 403) until it is
  enabled again. Its looks stay, shared ones in the gallery.
- **Delete**, after a confirm naming the account and how many looks go: as the account deleting itself ("Your
  account"), no password asked.
- An admin changes none of these for themselves (409): Account is theirs, and no admin locks themselves out.

## Privacy

**Privacy** (`/privacy`) is open to anyone, signed in or not, and linked from the sign-in page and the user menu
(guests' too). It says, plainly and briefly, what Studio keeps and for how long:

- **Accounts**: the username, a salted password hash, the role, when it was made and the tutorial's progress; no
  email or real name. Usernames show in the gallery.
- **Looks**: what each account saves, with its versions, bakes and previews; shared ones show in the gallery.
- **Visitors**: counted with a hash of the address and browser under a salt made each day and never written; no
  address is stored (Stats below). Behind the tunnel, the journal lines carry the visitor's country.
- **Bug reports** (F8 and Report this look, SPEC-reports): the note, a screenshot when it is on, the page's state
  (the unsaved look, the page's errors and messages) and the server's last warn and error lines, with the account's
  name; admins read them, and they go after `GET /api/privacy`'s `reportDays` (`STUDIO_REPORTS_DAYS`).
- **Cookies and storage**: one cookie, `studio_session`, the sign-in (30 days, a guest's 7), and nothing to track;
  the browser keeps a guest's work, the tutorial's place and view settings in its own storage.
- **Deleting**: Account's Delete account removes the account, its sessions and every look it owns at once; a
  guest's work goes with the browser's site data. Bug reports age out as above.

The page has no controls; a signed-out visitor gets a link back to sign in.

## Stats

The server counts in memory, from its start (a restart starts again; nothing is written), and Stats shows the counts:
today's as tiles, then the server's uptime, memory (RSS and heap) and 1-minute load; bakes finished in the last 24
hours, failed, and waiting now; each day's counts (the server's local days, the last 7 with requests); and the 10
latest requests that took 1 s or more.
`stats = { startedAt, uptime, memory: { rss, heap }, load, days: [{ day, visitors, people, views, requests, errors,
slow }], slowest: [{ at, method, route, status, ms }], bakes: { done, failed, waiting } }`, `days` newest first: `views` app pages served, `visitors` the browsers that loaded one, `people` the
accounts that made a signed-in request, `errors` 5xx answers. A **visitor** is the client's address (the tunnel's
forwarded one under `STUDIO_TRUST_PROXY`) and User-Agent hashed with a random salt made each day and never written,
so a day's visits tell apart without keeping who made them, and days do not link; at most 100,000 a day are told apart.

Each request worth reading is one journal line: `[studio] [http] GET /api/looks/:id 200 12ms 3.4KB v=1a2b3c4d NZ`:
the method; the API route's pattern (other paths as asked, without the query, cut to 80 printable characters); the
status, time and body size (`-` when streamed); `v=` the visitor's hash for that day; and, under `STUDIO_TRUST_PROXY`,
Cloudflare's `CF-IPCountry` when it is two capital letters. No query, cookie, header or address is written. Files
(`/assets`, `/data`, …), frame chunks and previews are counted but written only when they fail (4xx, 5xx)
or are slow. Nothing per frame: one hook per HTTP request, a hash only for a
line or a page.

When a local day ends, its counts are one journal line, with the bakes and the server's state at that moment:
`[studio] [stats] 2026-11-24 visitors=12 people=3 views=40 requests=900 errors=0 slow=2 bakes=5/0/0 uptime=86400s
rss=120MB`, `bakes` done/failed/waiting as in `stats.bakes`. A day the server started partway through counts from its
start.

## No AI

Studio has no AI: no Ideas page (`/ideas` leads to My looks; a guest's home is the Studio), no Refine, no invite
codes and no Models or Access tabs; sign-up says nothing of AI. The server has no idea, model, invite or people
routes, and leaves an older data folder's `ideas.json`, `invites.json`, `models.json` and `ideas-log/` unread.

## HTTP

```
POST   /api/guest    { name }                 → { user, flash }      in as a guest (sets cookie): "Guests"
PUT    /api/me/password { password, next }    → { ok: true }  a new password ("Your account")
DELETE /api/me       { password }             → { ok: true }  the account and its looks gone; clears the cookie
GET    /api/admin/stats                       → stats  admins only (403) ("Stats")
GET    /api/admin/accounts                    → { accounts: [account] }  admins only, as are the two below ("People")
PUT    /api/admin/accounts/:id { role?, disabled? } → { account }
DELETE /api/admin/accounts/:id                → { ok: true }  the account and its looks gone
```
