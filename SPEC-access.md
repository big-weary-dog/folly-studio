# Folly Studio — accounts and access (part of the contract)

Who has an account, what each role may do, the Admin pages, and who may use the paid models and how much.
`shared/schemas/access.ts` holds the access shapes; `src/auth.ts` accounts and sessions, `src/access.ts` and
`src/api-access.ts` the access rules and routes.

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
and `/api/guest` is 403 "Guests can't save", so they make no looks, ideas, bakes, reports, tour or invite, and, like everyone, have no AI ("No AI in the app"). The Studio keeps a guest's work in that browser
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
  deletes the account, its sessions and ideas, and every look it owns: shared ones leave the gallery too, with
  their frames and previews. A copy someone else saved of one is theirs and stays. The browser is signed out, on
  sign-in. The username is free again.
- A change or a deletion whose password changed, or whose session ended, while it was checked is 409: of two at once,
  one stands.
- A wrong password is 403 "That is not your password.". Wrong ones are limited as failed sign-ins are, 10 a minute per
  address and account, then 429 with `Retry-After`.

## Who may do what

A look is its owner's: only they edit it, and others see it only when it is shared. Only they delete it, but for an
admin, who may delete any shared look: Delete on its gallery card and in the Studio's gallery notice, after a confirm
naming the look and its owner. Asking for what a look does not allow them, anyone else is told it is not found
(404), shared or not, so an unshared look is never revealed.
A curator may also mark a look they can see reviewed (from the gallery, Approve), and bake it; admins are curators too, and alone use the Admin
pages and their `/api/admin` routes (403 for anyone else; each such route names its role, or the server does not
start) and Deep while it is admins' only.

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
Limits fields follow a successful Save or Defaults response; blank fields inherit the global allowance.

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

## Stats

The server counts in memory, from its start (a restart starts again; nothing is written), and Stats shows the counts:
today's as tiles, then the server's uptime, memory (RSS and heap) and 1-minute load; bakes and ideas finished in the
last 24 hours, failed, and waiting now; each day's counts (the server's local days, the last 7
with requests); and the 10 latest requests that took 1 s or more (an idea's long poll never counts as slow).
`stats = { startedAt, uptime, memory: { rss, heap }, load, days: [{ day, visitors, people, views, requests, errors,
slow }], slowest: [{ at, method, route, status, ms }], bakes: { done, failed, waiting }, ideas?: { made, failed,
waiting } }`, `days` newest first: `views` app pages served, `visitors` the browsers that loaded one, `people` the
accounts that made a signed-in request, `errors` 5xx answers. A **visitor** is the client's address (the tunnel's
forwarded one under `STUDIO_TRUST_PROXY`) and User-Agent hashed with a random salt made each day and never written,
so a day's visits tell apart without keeping who made them, and days do not link; at most 100,000 a day are told apart.

Each request worth reading is one journal line: `[studio] [http] GET /api/looks/:id 200 12ms 3.4KB v=1a2b3c4d NZ`:
the method; the API route's pattern (other paths as asked, without the query, cut to 80 printable characters); the
status, time and body size (`-` when streamed); `v=` the visitor's hash for that day; and, under `STUDIO_TRUST_PROXY`,
Cloudflare's `CF-IPCountry` when it is two capital letters. No query, cookie, header or address is written. Files
(`/assets`, `/data`, …), frame chunks, previews and idea polls are counted but written only when they fail (4xx, 5xx)
or are slow. Nothing per frame: one hook per HTTP request, a hash only for a
line or a page.

## Access (invite codes and limits)

Anyone may sign up, browse, edit, preview and use the gallery; turning ideas into looks needs an invite code, as
every model is paid. A **paid** model (every `via`: it spends money or the owner's capacity) needs an **unlocked** account, and every account's ideas are **limited**. Admins are
exempt from both. The registry's `limits` (defaults below) and each model's own `limits` set them:

```
"limits"?: { "inviteOnly": true, "perHour": 6, "perDay": 20, "concurrent": 2, "dailyCeiling": 200 }
models[i].limits?: { "perHour"?, "perDay"?, "concurrent"? }
```

- An account's paid ideas share one allowance: `perHour` and `perDay` count its paid ideas created in the last 60
  minutes and 24 hours (rolling), `concurrent` those queued or generating. A model's `limits` add a cap counted on
  that model's ideas alone; a free model would be limited only by its own. `dailyCeiling` counts everyone's paid ideas in 24 hours, a spend backstop. `inviteOnly: false` unlocks
  everyone (a private server). A cap of 0 allows none: its 429 has no `Retry-After` and no `nextAt`.
- **One idea is one use** (a Deep idea `DEEP.uses`: SPEC-generators "Explore"; with room for fewer, it is refused),
  counted when POST /api/ideas (or a look's refine) accepts it, whatever comes of it:
  retries and any repair, check or critique inside its job add nothing; "Try again" sends a new idea.
  The check and the create are one synchronous step, so two requests cannot both take the last use.
- A stored user may hold `access = { unlockedAt?, invite?, by?, limits?, resetAt? }`: `invite` the code's id that
  unlocked it, `by` the admin who did; `limits` an admin's override of the global three for this person; ideas
  created before `resetAt` do not count.
- **Invite codes** (`invites.json`): `{ id, hash, label?, uses, used, expiresAt?, revokedAt?, createdBy, createdAt,
  updatedAt }`; `hash` is sha256 of the code normalised (upper case, no spaces or dashes); the code itself, 12
  characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789` shown as `XXXX-XXXX-XXXX`, is answered once and never stored.
  `uses` 1–1000 (default 1), `days` 1–365 until it expires (none: never). Redeeming takes a use from a code that is
  not revoked, expired or used up and unlocks the account; an unlocked account redeeming changes nothing. Any other
  code is a 400 that says which: not valid (no such code), used up, expired or revoked. Attempts are limited per
  account (5 failures in 15 minutes) and per address (20 failures in 15 minutes): 429 with `Retry-After`.
- `access = { unlocked, exempt, inviteOnly, limits: { perHour, perDay, concurrent }, left: { hour, day, running },
  nextAt?, full?, models?: { [id]: { hour?, day? } } }` in /api/me and with a 403 or 429: `left` the paid uses this
  account has; `nextAt` when the next frees (when one is 0); `full` the ceiling is reached; `models` what is left on
  each model with its own limits. `invite = { id, label?, uses, used, expiresAt?, revokedAt?, createdBy, createdAt,
  state: 'active' | 'used' | 'expired' | 'revoked' }`. `person = { id, username, role, access: { unlockedAt?, invite?,
  by?, limits?, resetAt? }, used: { hour, day, running } }`.

**No AI in the app.** The app has no Ideas page (`/ideas` leads to My looks; a guest's home is the Studio), no
Refine, no invite code entry and no Models or Access tabs, for everyone; sign-up says nothing of AI.

## HTTP

```
POST   /api/guest    { name }                 → { user, flash }      in as a guest (sets cookie): "Guests"
PUT    /api/me/password { password, next }    → { ok: true }  a new password ("Your account")
DELETE /api/me       { password }             → { ok: true }  the account and its looks gone; clears the cookie
POST   /api/invite   { code }                 → { access }           redeem an invite code ("Access")
GET    /api/admin/invites                     → { invites: [invite] }  admins only, as are the four below
POST   /api/admin/invites { label?, uses?, days? } → 201 { invite, code }  the code is shown only here
DELETE /api/admin/invites/:id                 → { invite }           revoked (kept, so the list says so)
GET    /api/admin/people                      → { people: [person] }
PUT    /api/admin/people/:id { unlocked?, limits?, reset? } → { person }  limits: null clears the override
GET    /api/admin/stats                       → stats  admins only (403) ("Stats")
GET    /api/admin/accounts                    → { accounts: [account] }  admins only, as are the two below ("People")
PUT    /api/admin/accounts/:id { role?, disabled? } → { account }
DELETE /api/admin/accounts/:id                → { ok: true }  the account and its looks gone
```
