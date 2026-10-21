# Folly Studio — accounts and access (part of the contract)

Who has an account, what each role may do, the Admin pages, and who may use the paid models and how much.
`shared/schemas/access.ts` holds the access shapes; `src/auth.ts` accounts and sessions, `src/access.ts` and
`src/api-access.ts` the access rules and routes.

## Accounts

`user = { id, username, role: 'member' | 'curator' | 'admin' }` (curators listed in `STUDIO_CURATORS`, admins in
`STUDIO_ADMINS`; an admin is also a curator). Signing up or in is limited per client address (100 a minute) and, for
failures, per address and username (10 a minute): 429 with `Retry-After`. Password hashes run 3 at once with 30
waiting; past that, 429 "busy". A route that needs a session is 401 without one; the app takes a 401 from anything
but `/api/me`, `/api/login` and `/api/signup` as the session ending, and goes back to sign-in.

## Who may do what

A look is its owner's: only they edit or delete it, and others see it only when it is shared. Asking for what a look
does not allow them, anyone else is told it is not found (404), shared or not, so an unshared look is never revealed.
A curator may also mark a look they can see reviewed, and bake it; admins are curators too, and alone use the Admin
pages and their `/api/admin` routes (403 for anyone else; each such route names its role, or the server does not
start), the Pi preview (SPEC "The Pi preview") and Deep while it is admins' only. Who controls the live stage is its
own setting (SPEC-live "Settings").

## Admin

Admins' header has one more item, **Admin** (`/admin`, which opens its first tab), where everyone else's has none.
Its tabs are pages of their own: Models (`/admin/models`, SPEC-generators "Models"), Access (`/admin/access`,
Access below), Light (`/admin/light`, SPEC "Light and output") and Reports (`/admin/reports`, SPEC "Bug reports"),
then a link to the Pi preview (`/pi/`, in a new tab). The old `/models`, `/access`, `/light` and `/reports` lead to their
tab, query kept. Anyone else who opens one gets the page without the tabs, its admin calls refused (403) as it says.

## Access (invite codes and limits)

Anyone may sign up, browse, edit, preview and use the gallery; turning ideas into looks needs an invite code, as
Sketch, the one free model, is offered to admins alone (SPEC-generators "Models"). A **paid** model (any `via` but
`sketch`: it spends money or the owner's capacity) needs an **unlocked** account, and every account's ideas are **limited**. Admins are
exempt from both. The registry's `limits` (defaults below) and each model's own `limits` set them:

```
"limits"?: { "inviteOnly": true, "perHour": 6, "perDay": 20, "concurrent": 2, "dailyCeiling": 200 }
models[i].limits?: { "perHour"?, "perDay"?, "concurrent"? }
```

- An account's paid ideas share one allowance: `perHour` and `perDay` count its paid ideas created in the last 60
  minutes and 24 hours (rolling), `concurrent` those queued or generating. A model's `limits` add a cap counted on
  that model's ideas alone; a free model is limited only by its own (the default Sketch entry: 30 an hour, 100 a
  day). `dailyCeiling` counts everyone's paid ideas in 24 hours, a spend backstop. `inviteOnly: false` unlocks
  everyone (a private server). A cap of 0 allows none: its 429 has no `Retry-After` and no `nextAt`.
- **One idea is one use** (a Deep idea `DEEP.uses`: SPEC-generators "Explore"; with room for fewer, it is refused),
  counted when POST /api/ideas (or a look's refine) accepts it, whatever comes of it:
  retries and any repair, check or critique inside its job add nothing; "Try again" sends a new idea.
  The check and the create are one synchronous step, so two requests cannot both take the last use.
- A stored user may hold `access = { unlockedAt?, invite?, by?, limits?, resetAt? }`: `invite` the code's id that
  unlocked it, `by` the admin who did; `limits` an admin's override of the global three for this person; ideas
  created before `resetAt` no longer count.
- **Invite codes** (`invites.json`): `{ id, hash, label?, uses, used, expiresAt?, revokedAt?, createdBy, createdAt,
  updatedAt }`; `hash` is sha256 of the code normalised (upper case, no spaces or dashes); the code itself, 12
  characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789` shown as `XXXX-XXXX-XXXX`, is answered once and never stored.
  `uses` 1–1000 (default 1), `days` 1–365 until it expires (none: never). Redeeming takes a use from a code that is
  not revoked, expired or used up and unlocks the account; an unlocked account redeeming changes nothing. Any other
  code is a 400 that says which: not valid (no such code), used up, expired or revoked. Attempts are limited per
  account (5 failures in 15 minutes) and per address (20 failures in 15 minutes): 429 with `Retry-After`.
- An **invite link** is `/#invite=CODE` (the Access page offers it beside a new code): in the fragment, the code never
  reaches the server's logs or a Referer. The app takes it out of the address into the tab's sessionStorage, asks a
  signed-out visitor to sign up or in, then redeems it once and drops it, saying it was accepted or why not.
- `access = { unlocked, exempt, inviteOnly, limits: { perHour, perDay, concurrent }, left: { hour, day, running },
  nextAt?, full?, models?: { [id]: { hour?, day? } } }` in /api/me and with a 403 or 429: `left` the paid uses this
  account has; `nextAt` when the next frees (when one is 0); `full` the ceiling is reached; `models` what is left on
  each model with its own limits. `invite = { id, label?, uses, used, expiresAt?, revokedAt?, createdBy, createdAt,
  state: 'active' | 'used' | 'expired' | 'revoked' }`. `person = { id, username, role, access: { unlockedAt?, invite?,
  by?, limits?, resetAt? }, used: { hour, day, running } }`.

## HTTP

```
POST   /api/invite   { code }                 → { access }           redeem an invite code ("Access")
GET    /api/admin/invites                     → { invites: [invite] }  admins only, as are the four below
POST   /api/admin/invites { label?, uses?, days? } → 201 { invite, code }  the code is shown only here
DELETE /api/admin/invites/:id                 → { invite }           revoked (kept, so the list says so)
GET    /api/admin/people                      → { people: [person] }
PUT    /api/admin/people/:id { unlocked?, limits?, reset? } → { person }  limits: null clears the override
```
