// Usage: node scripts/generate-batch.mjs <count>
// Writes kv-bulk.json (for `wrangler kv bulk put`) and tags.csv (secrets: never commit).
// ADMIN_HASH_SALT must be set in the environment and match the Worker's secret.
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const count = Number(process.argv[2]);
const salt = process.env.ADMIN_HASH_SALT;
const base = process.env.PUBLIC_BASE_URL || "https://vi-key.uk";

if (!Number.isInteger(count) || count < 1 || count > 10000) {
  console.error("Usage: ADMIN_HASH_SALT=... node scripts/generate-batch.mjs <count 1-10000>");
  process.exit(1);
}
if (!salt) {
  console.error("Set ADMIN_HASH_SALT to the same value as the Worker secret.");
  process.exit(1);
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function random(alphabet, length) {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

async function sha256Hex(value) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${value}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ids = new Set();
const bulk = [];
const rows = ["url,claim_code"];

while (ids.size < count) {
  const id = random(ID_ALPHABET, 12);
  if (ids.has(id)) continue;
  ids.add(id);
  const code = random(CODE_ALPHABET, 8);
  bulk.push({
    key: `lf:tag:${id}`,
    value: JSON.stringify({
      status: "unclaimed",
      claimHash: await sha256Hex(code),
      manageHash: null,
      kind: "pet",
      name: "",
      desc: "",
      needs: "",
      temper: "",
      note: "",
      phoneEnc: "",
      contactMethods: [],
      revealMode: "always",
      lost: false,
      lostUntil: 0,
      createdAt: Date.now(),
      claimedAt: 0,
    }),
  });
  rows.push(`${base}/found/${id},${code}`);
}

writeFileSync("kv-bulk.json", JSON.stringify(bulk, null, 2));
writeFileSync("tags.csv", rows.join("\n") + "\n");
console.log(`Wrote ${count} tags to kv-bulk.json and tags.csv (keep both private).`);
