# Security Test Checklist

Prerequisites: `SECURITY_SETUP.md` completed, an `__admin__` password hash exists, deployed to `https://$HOST`.

## Admin login
- [ ] Open the admin page and log in with the **correct** password → success, admin panel shown.
- [ ] `sessionStorage` contains the session token and expiry; the panel shows "Session expires in X minutes".

## Incorrect password and rate limit
- [ ] Attempt 1 with a wrong password → `401 Incorrect password`.
- [ ] Attempt 2 with a wrong password → `401`.
- [ ] Attempt 3 with a wrong password → `429 Too many failed attempts` with a `Retry-After` header (~900).
- [ ] Attempt 4 with the **correct** password → still `429` (locked).

## Rate limit lockout timing
- [ ] Note the lock time; `Retry-After` counts down from ~900 seconds on repeated attempts.
- [ ] After 15 minutes (or after deleting the `rate_limit:<ip>` key in `RATE_LIMIT`) login works again.

## Create memorial password and content
- [ ] Logged in, set a password for a memorial → `{success:true}`; the KV value in `MEMORIAL_PASSWORDS` is a bcrypt hash (starts with `$2`), not plaintext.
- [ ] Verify that password for the memorial page → success; wrong password → `401`.
- [ ] Create memorial content → success; `get`/`list` also work.
- [ ] Repeat for a pet memorial (`/api/pet-password`, `/api/pet-content`).

## Session token in headers
- [ ] In DevTools → Network, every admin `set`/`delete` request carries `X-Admin-Session`.
- [ ] Replay a `set` request with the header removed → `401`.
- [ ] Replay with a made-up token → `401`.

## Session expiry
- [ ] Wait 30 minutes (or delete the key in `ADMIN_SESSIONS`) → next admin request returns `401` and the UI logs out.

## HTTPS
- [ ] `curl -i http://$HOST/api/password -d '{}'` → `403 HTTPS required` (or redirect to HTTPS).
- [ ] The same request over `https://` is processed normally.
