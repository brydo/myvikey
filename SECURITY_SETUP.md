# Security Setup Guide

The backend (Cloudflare Pages Functions in `functions/`) uses bcrypt-hashed passwords, server-side admin sessions, per-IP rate limiting and HTTPS enforcement.

## Security model

| Feature | Behaviour |
|---|---|
| Password storage | bcrypt (`bcryptjs`, 12 salt rounds) in `MEMORIAL_PASSWORDS` / `PET_PASSWORDS` |
| Admin login | `POST /api/password` `{action:"verify", id:"__admin__", password}` returns `sessionToken` + `expiresAt` |
| Session | Stored in `ADMIN_SESSIONS` with a 30-minute TTL; sent as the `X-Admin-Session` header |
| Protected actions | `set`/`delete` on `/api/password`, `/api/pet-password`, `/api/content`, `/api/pet-content` return `401` without a valid session |
| Rate limiting | 3 failed admin logins within 5 minutes lock the IP for 15 minutes (`429` + `Retry-After`) |
| HTTPS | Plain HTTP requests are rejected with `403` |

> Bootstrap note: until an `__admin__` password exists, `verify` for `__admin__` succeeds without a token and set actions require a session. Create the first admin hash manually (see Troubleshooting).

## 1. Install dependencies

```sh
npm install
```

`bcryptjs` is pure JavaScript and works in the Workers runtime (Pages bundles it from `node_modules`).

## 2. Create the 6 KV namespaces

```sh
npx wrangler kv namespace create MEMORIAL_PASSWORDS   # hashed passwords
npx wrangler kv namespace create PET_PASSWORDS        # hashed passwords
npx wrangler kv namespace create MEMORIAL_CONTENT     # memorial data
npx wrangler kv namespace create PET_CONTENT          # pet memorial data
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

Placeholders: `your_memorial_passwords_id`, `your_pet_passwords_id`, `your_memorial_content_id`, `your_pet_content_id`, `your_admin_sessions_id`, `your_rate_limit_id`.

If you deploy through the Cloudflare dashboard, instead add the same 6 bindings under **Pages project → Settings → Functions → KV namespace bindings** (the variable names must match exactly).

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

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot read properties of undefined (reading 'get')` | A KV binding is missing or misnamed; check all 6 bindings. |
| `Could not resolve "bcryptjs"` at build | Run `npm install` and make sure `package.json` is committed. |
| Always `401` on admin actions | Frontend isn't sending `X-Admin-Session`, session expired, or `ADMIN_SESSIONS` binding points at the wrong namespace. |
| Locked out during testing | Delete the key: `npx wrangler kv key delete "rate_limit:<ip>" --namespace-id <RATE_LIMIT id>`. |
| Existing plaintext passwords no longer work | They must be re-set as bcrypt hashes. Generate one with `node -e "console.log(require('bcryptjs').hashSync('NEW_PASSWORD',12))"` and store it: `npx wrangler kv key put __admin__ '<hash>' --namespace-id <MEMORIAL_PASSWORDS id>`. |
| `403 HTTPS required` locally | Local dev uses HTTP; test against the deployed HTTPS URL. |
