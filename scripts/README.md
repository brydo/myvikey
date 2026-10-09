# Seed KV sample data

`seed-kv.mjs` writes sample entries to Cloudflare Workers KV:

| Namespace | Keys |
|---|---|
| `PET_CONTENT` | `charlie`, `robbie` |
| `MEMORIAL_CONTENT` | `margaret`, `james` |
| `PET_PASSWORDS` | `charlie`, `robbie` (bcrypt hashes) |
| `MEMORIAL_PASSWORDS` | `margaret`, `james` (bcrypt hashes) |

Content fields: `name`, `photoUrl`, `text` (story), `born`, `passed`, `dob` (display string used by the viewer pages), `audioUrl` (optional), `photoPosition` (default `50% 50%`).

## Run

1. In the Cloudflare dashboard, copy the namespace IDs (Workers KV) and create an API token with **Workers KV Storage: Edit**.
2. Then:

```bash
npm install
export CF_ACCOUNT_ID=...  CF_API_TOKEN=...
export PET_CONTENT_ID=... MEMORIAL_CONTENT_ID=... PET_PASSWORDS_ID=... MEMORIAL_PASSWORDS_ID=...
npm run seed            # password defaults to "password123"; override with SEED_PASSWORD
npm run seed -- --dry-run   # preview without calling the API
```

Then visit `/foreverpets/view.html?id=charlie` or `/memorials/view.html?id=margaret` (password: `password123`).

The sample photos are placeholders; replace them via the admin pages. The seed overwrites these keys if they already exist, so change the passwords afterwards.

## Alternative: curl

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces/$PET_CONTENT_ID/values/charlie" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"name":"Charlie","photoUrl":"","text":"A loyal companion.","born":"2008-04-12","passed":"2022-09-03","dob":"12 April 2008 – 3 September 2022","audioUrl":"","photoPosition":"50% 50%"}'
```

Generate a password hash with `node -e "import('bcryptjs').then(b=>b.default.hash('password123',12).then(console.log))"` and PUT it the same way to the `*_PASSWORDS` namespace.
