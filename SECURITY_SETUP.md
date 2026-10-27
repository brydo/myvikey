# Security Setup Guide

The backend (Cloudflare Pages Functions in `functions/`) uses bcrypt-hashed passwords, server-side admin sessions, per-IP rate limiting and HTTPS enforcement.

## Security model

| Feature | Behaviour |
|---|---|
| Password storage | bcrypt (`bcryptjs`, 12 salt rounds) in `MEMORIAL_PASSWORDS` / `PET_PASSWORDS` / `CARD_PASSWORDS` |
| Admin login | `POST /api/password` `{action:"verify", id:"__admin__", password}` returns `sessionToken` + `expiresAt` |
| Session | Stored in `ADMIN_SESSIONS` with a 30-minute TTL; sent as the `X-Admin-Session` header |
| Protected actions | `set`/`delete` on `/api/password`, `/api/pet-password`, `/api/card-password`, `/api/content`, `/api/pet-content`, `/api/card-content` return `401` without a valid session |
| Rate limiting | 3 failed admin logins within 5 minutes lock the IP for 15 minutes (`429` + `Retry-After`) |
| HTTPS | Plain HTTP requests are rejected with `403` |

> Bootstrap note: until an `__admin__` password exists, `verify` for `__admin__` succeeds without a token and set actions require a session. Create the first admin hash manually (see Troubleshooting).

## 1. Install dependencies

```sh
npm install
```

`bcryptjs` is pure JavaScript and works in the Workers runtime (Pages bundles it from `node_modules`).

## 2. Create the 8 KV namespaces

```sh
npx wrangler kv namespace create MEMORIAL_PASSWORDS   # hashed passwords
npx wrangler kv namespace create PET_PASSWORDS        # hashed passwords
npx wrangler kv namespace create MEMORIAL_CONTENT     # memorial data
npx wrangler kv namespace create PET_CONTENT          # pet memorial data
npx wrangler kv namespace create CARD_PASSWORDS       # hashed passwords (MyCard)
npx wrangler kv namespace create CARD_CONTENT         # MyCard business card data
npx wrangler kv namespace create ADMIN_SESSIONS       # session tokens (30-min TTL)
npx wrangler kv namespace create RATE_LIMIT           # per-IP rate limiting
```

Each command prints an `id`.

## 3. Update `wrangler.toml`

Replace each placeholder in `wrangler.toml` with the printed ID:

```toml
[[env.production.kv_namespaces]]
binding = "ADMIN_SESSIONS"
id = "<id printed by wrangler>"
```

Placeholders: `your_memorial_passwords_id`, `your_pet_passwords_id`, `your_memorial_content_id`, `your_pet_content_id`, `your_card_passwords_id`, `your_card_content_id`, `your_admin_sessions_id`, `your_rate_limit_id`.

If you deploy through the Cloudflare dashboard, instead add the same 8 bindings under **Pages project → Settings → Functions → KV namespace bindings** (the variable names must match exactly).

## 4. Deploy

```sh
npx wrangler pages deploy .
```

## 5. Testing

Use `SECURITY_TEST.md` for the full checklist. Quick checks (replace `$HOST`):

- **Login:** `curl -s https://$HOST/api/password -H 'content-type: application/json' -d '{"action":"verify","id":"__admin__","password":"..."}'` → `sessionToken`.
- **Session validation:** call `/api/content` with `action:"set"` with and without `-H "X-Admin-Session: <token>"`; without it → `401`.
- **Rate limiting:** 3 wrong passwords → third response is `429` with `Retry-After` (~900s).
- **HTTPS:** `curl -i http://$HOST/api/password ...` → `403`.
- **Expiry:** after 30 minutes the token returns `401`.

## RSVP

The standalone RSVP section is served at `/rsvp/`, with confirmation at
`/rsvp/view` and response review at `/rsvp/admin`. It reuses the existing
`FORM_SUBMISSIONS` KV binding used by the site's forms, storing only Name,
Event, Attending, Guests (additional guests), and Notes under `rsvp:` keys.
Ensure that binding is configured in the Pages project's production and preview
environments; submissions return an error rather than a success message if storage
is unavailable. No additional KV namespace is needed.

RSVP admin uses the same `/api/password` login as MyCard: the `__admin__` hash in
`MEMORIAL_PASSWORDS`, plus `ADMIN_SESSIONS` and `RATE_LIMIT`. Response listing
requires a valid `X-Admin-Session` token. The confirmation is stored only in the
submitting browser tab's session storage; there is no public response lookup.

Run the focused tests with `node --test rsvp/rsvp.test.cjs mycard/card-render.test.cjs`.

### RSVP invitation links and optional guest passwords

Invitation sharing uses `/rsvp/i/<code>` across celebration, events, weddings,
parties and engagements. Each invitation gets a random **7-character** code from
`A–Z`, `a–z`, `0–9`, `-` and `_`, generated with `crypto.getRandomValues()`.
Codes are case-sensitive and have 42 bits of randomness; they are not authentication
tokens. Use a guest password for private invitations. The code is the sole
invitation ID, stored directly under `rsvp-invitation:<code>` and used in reply
associations. Creation checks storage before saving, retries collisions up to
10 times, and returns a retryable 503 error if no unused code is found.
Edits preserve the code. `/rsvp/i/` is reserved for invitation links, leaving
category pages, admin, receipts and assets unchanged. Query-based invitation and
receipt pages also accept only these 7-character IDs.

**Testing-phase breaking change: no backward compatibility.** UUID and reversible
22-character invitation IDs are rejected by routing and API lookups. Old
invitations are omitted from the authenticated, cursor-paginated invitation list
(50 storage keys per page); create new invitations in admin and share the new
links. No migration, backfill, alias map or additional KV namespace is introduced.
Old stored invitations and replies are not rewritten or automatically deleted;
old replies remain available in the admin response list.
Saving preserves unknown stored fields; public and admin invitation payloads
allowlist display fields rather than returning stored secrets. Deletion removes
the invitation, disabling its link.

Repository inspection found an RSVP **admin** password but no existing
per-invitation guest password enforcement. This change adds an optional guest
password, set/change/remove controls in RSVP admin and a guest unlock prompt.
New invitations remain public unless an admin explicitly sets a
guest password. Leaving the password blank when editing preserves protection;
removal is explicit. No password is generated automatically.

Guest passwords use the existing bcrypt helper (12 rounds, at least 8 characters
with a non-space character and at most 72 UTF-8 bytes), stored as
`guestPasswordHash` on the invitation, never returned in API
payloads. Unlock attempts use the existing rate limiter in a separate
`rsvp-guest:` IP bucket (3 failures in 5 minutes, 15-minute lockout). A successful
unlock issues an opaque 30-minute token scoped to the canonical invitation and
its current password revision. Guest sessions use `rsvp-guest-session:` keys in
`FORM_SUBMISSIONS`, never the admin-session namespace, and cannot authorize admin
actions. Both reads and submissions enforce guest access
server-side; an admin preview session is not a
guest submission credential. Changing/removing protection invalidates previous
protected sessions. MyCard password handling and shared admin login are unchanged.

**Rollout (not performed by this code change):**

1. Deploy the Pages assets **and Functions** together, including the RSVP routing
   middleware. Publishing static files alone does not enable short routes.
2. Verify `FORM_SUBMISSIONS`, `ADMIN_SESSIONS` and `RATE_LIMIT` bindings in both
   preview and production. Guest authentication fails closed if its required
   bindings are unavailable.
3. Create new invitations and check their 7-character links, all five category
   entrypoints, admin editing, and a password-protected invitation's read/submit
   flow before sharing production links. Confirm UUID and 22-character links fail.
   Recreate any testing invitations you still need; legacy links will not work.
4. Account for Cloudflare KV's eventual consistency: invitation edits, password
   changes, guest sessions and deletion may take time to propagate between
   locations. The existing KV rate limiter is best-effort, not an atomic global
   counter; use Cloudflare edge rate-limiting rules if strict distributed limits
   are required. Code collision checks are also best-effort: KV has no atomic
   create-if-absent operation, so simultaneous creates in different Workers can
   theoretically race. Codes have 64^7 possibilities; no separate alias cache is used.

Run all current regression tests with
`node --test rsvp/*.test.cjs mycard/*.test.cjs`.
The browser suite requires Chromium and Node 22+ (or `CHROME_PATH`).

### MyCard landing background

The `/mycard/` landing restores `#121212` from commit
`7d29ddaddfbbab6ec6ee16ea7d7e648bd4d39b01`. Commit
`00a99ce9267ca776297c6be8aafe0db64d5b1e58` subsequently added the white
`html, body` `!important` override; only that override is removed. Newer content,
responsive layout, viewer/admin styling and MyCard password controls remain.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot read properties of undefined (reading 'get')` | A KV binding is missing or misnamed; check all 8 bindings. |
| `Could not resolve "bcryptjs"` at build | Run `npm install` and make sure `package.json` is committed. |
| Always `401` on admin actions | Frontend isn't sending `X-Admin-Session`, session expired, or `ADMIN_SESSIONS` binding points at the wrong namespace. |
| Locked out during testing | Delete the key: `npx wrangler kv key delete "rate_limit:<ip>" --namespace-id <RATE_LIMIT id>`. |
| Existing plaintext passwords no longer work | They must be re-set as bcrypt hashes. Generate one with `node -e "console.log(require('bcryptjs').hashSync('NEW_PASSWORD',12))"` and store it: `npx wrangler kv key put __admin__ '<hash>' --namespace-id <MEMORIAL_PASSWORDS id>`. |
| `403 HTTPS required` locally | Local dev uses HTTP; test against the deployed HTTPS URL. |
