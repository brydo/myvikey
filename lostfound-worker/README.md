# V I Key® Lost & Found

Cloudflare Worker for NFC tags that link to `https://vi-key.uk/found/<id>`. Owners claim a tag, add details, and mark it lost. Finders see the details and can call, WhatsApp or text the owner from their own phone.

- Routes: `vi-key.uk/found/*` and `vi-key.uk/manage/*` only. Worker name: `vikey-lostfound-worker`.
- Storage: a **new, dedicated** KV namespace bound as `TAGS`, every key prefixed `lf:`.
- No accounts, cookies, IP logging, analytics, SMS/WhatsApp services or third-party scripts (except Cloudflare Turnstile).
- The product page `/lostandfound` is part of the existing site, not this Worker.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run dev   # needs .dev.vars (see below)
```

`.dev.vars` (git-ignored) for local use. These are Cloudflare's public Turnstile test keys, which always pass:

```
ENCRYPTION_KEY=<openssl rand -base64 32>
ADMIN_HASH_SALT=<any random string>
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
```

and temporarily set `TURNSTILE_SITE_KEY = "1x00000000000000000000AA"` in `wrangler.toml`.

## Provisioning KV (new namespace only)

No namespace ID is committed. Wrangler 4.45+ creates and binds a new namespace automatically on the first `wrangler deploy`.

If your wrangler version or CI cannot do that, create it manually and inject the ID at deploy time only:

```sh
npx wrangler kv namespace create vikey-lostfound
# copy the returned id into a local, uncommitted override, e.g. wrangler.local.toml
```

Never reuse or edit an existing namespace.

## Owner setup

1. Create the GitHub repo and push this code.
2. Deploy once (`npm run deploy`) so the new KV namespace is created and bound. Confirm your existing namespaces, bindings, Workers and routes are unchanged in the Cloudflare dashboard.
3. In Cloudflare (Workers & Pages), connect the repo for automatic deploys on push to `main`.
4. Create a Turnstile widget for `vi-key.uk`. Put the **site key** in `TURNSTILE_SITE_KEY` in `wrangler.toml`.
5. Set secrets (never commit):
   ```sh
   openssl rand -base64 32 | npx wrangler secret put ENCRYPTION_KEY
   openssl rand -base64 32 | npx wrangler secret put ADMIN_HASH_SALT
   npx wrangler secret put TURNSTILE_SECRET
   ```
   Keep a private copy of `ADMIN_HASH_SALT`: the batch script needs the same value, and changing it later invalidates existing claim codes and manage links.
6. Generate tags and upload:
   ```sh
   ADMIN_HASH_SALT=<same salt> npm run batch -- 100
   npx wrangler kv bulk put kv-bulk.json --binding TAGS --remote
   ```
   `tags.csv` (URL + claim code) goes to the NFC writer app and the claim cards. Both files contain secrets and are git-ignored. Write each URL to a tag, then lock it.
7. Pay the ICO data protection fee and add a Lost & Found section to the privacy policy naming Cloudflare as a provider.

## Notes

- KV is eventually consistent: lost/found changes can take about a minute to appear. The manage page says so.
- Reveal is limited to 10 per tag per hour; claim attempts to 10 per tag per hour.
- Delete removes the tag record and its rate-limit keys.
- Check `/found/*`, `/manage/*` and `/lostandfound` don't clash with any existing page or route on the site before deploying.
