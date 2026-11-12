import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { sha256Hex } from "../src/lib/crypto.ts";
import { LINKS_JS } from "../src/views/links.ts";
import { normalisePhone } from "../src/lib/validate.ts";

class FakeKV {
  m = new Map<string, string>();
  async get(k: string, type?: string) {
    const v = this.m.get(k);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
  async list({ prefix }: { prefix: string }) {
    return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}

const SALT = "salt";
const ID = "abcdefghij23";
const CODE = "ABCD2345";
const mk = () => {
  const kv = new FakeKV();
  const env: any = {
    TAGS: kv, PUBLIC_BASE_URL: "https://vi-key.uk", LOST_MODE_DAYS: "14", TURNSTILE_SITE_KEY: "site",
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), ADMIN_HASH_SALT: SALT, TURNSTILE_SECRET: "sec",
  };
  return { kv, env };
};
async function seed(kv: FakeKV) {
  kv.m.set(`lf:tag:${ID}`, JSON.stringify({ status: "unclaimed", claimHash: await sha256Hex(SALT, CODE), manageHash: null }));
}
const call = (env: any, path: string, init?: RequestInit) => worker.fetch(new Request("https://vi-key.uk" + path, init), env);
const post = (env: any, path: string, body: Record<string, string | string[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return call(env, path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: p });
};
const claimBody = (over: Record<string, string | string[]> = {}) => ({
  code: CODE, kind: "pet", name: "Rex <b>", desc: "Brown dog", needs: "", temper: "shy", note: "Hi",
  phone: "07123 456789", methods: ["call", "whatsapp", "sms"], revealMode: "always", ...over,
});
const realFetch = globalThis.fetch;
const turnstile = (ok: boolean) => { globalThis.fetch = (async () => new Response(JSON.stringify({ success: ok }))) as any; };
test.afterEach(() => { globalThis.fetch = realFetch; });

async function claimed(revealMode = "always") {
  const { kv, env } = mk();
  await seed(kv);
  const res = await post(env, `/found/${ID}/claim`, claimBody({ revealMode }));
  const text = await res.text();
  const secret = text.match(/manage\/[a-z2-7]+\/([A-Za-z0-9_-]{43})/)![1];
  return { kv, env, res, text, secret };
}

test("unknown id is generic 404; unclaimed shows claim page; wrong code rejected", async () => {
  const { kv, env } = mk();
  assert.equal((await call(env, `/found/${ID}`)).status, 404);
  await seed(kv);
  assert.match(await (await call(env, `/found/${ID}`)).text(), /Claim code/);
  const bad = await post(env, `/found/${ID}/claim`, claimBody({ code: "WRONG222" }));
  assert.equal(bad.status, 403);
  assert.equal(JSON.parse(kv.m.get(`lf:tag:${ID}`)!).status, "unclaimed");
});

test("claim shows manage link + test buttons; phone not in finder page or stored plain", async () => {
  const { kv, env, res, text, secret } = await claimed();
  assert.equal(res.status, 200);
  assert.match(text, /Check your contact buttons/);
  assert.match(res.headers.get("content-security-policy")!, /default-src 'none'/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(text.includes("Rex &#60;b&#62;"));
  const stored = kv.m.get(`lf:tag:${ID}`)!;
  assert.ok(!stored.includes("7123") && !stored.includes(CODE));
  assert.equal(JSON.parse(stored).claimHash, null);
  const finder = await (await call(env, `/found/${ID}`)).text();
  assert.ok(!finder.includes("7123") && !finder.includes("447"));
  assert.equal((await call(env, `/manage/${ID}/${secret}`)).status, 200);
  assert.equal((await call(env, `/manage/${ID}/${"x".repeat(43)}`)).status, 404);
  assert.equal((await post(env, `/found/${ID}/claim`, claimBody())).status, 404);
});

test("reveal needs turnstile; lostonly gating; always works", async () => {
  const a = await claimed("always");
  const rev = (env: any) => call(env, `/found/${ID}/reveal`, { method: "POST", body: JSON.stringify({ token: "t" }) });
  turnstile(false);
  assert.equal((await rev(a.env)).status, 403);
  turnstile(true);
  const ok = await rev(a.env);
  assert.deepEqual(await ok.json(), { number: "+447123456789", methods: ["call", "whatsapp", "sms"] });

  const b = await claimed("lostonly");
  assert.equal((await rev(b.env)).status, 404);
  await post(b.env, `/manage/${ID}/${b.secret}/lost`, {});
  assert.equal((await rev(b.env)).status, 200);
});

test("reveal is rate limited", async () => {
  const a = await claimed();
  turnstile(true);
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await call(a.env, `/found/${ID}/reveal`, { method: "POST", body: JSON.stringify({ token: "t" }) })).status;
  assert.equal(last, 429);
});

test("lost mode, expiry, renew, found", async () => {
  const { kv, env, secret } = await claimed();
  await post(env, `/manage/${ID}/${secret}/lost`, {});
  assert.match(await (await call(env, `/found/${ID}`)).text(), /reported LOST/);
  const rec = JSON.parse(kv.m.get(`lf:tag:${ID}`)!);
  assert.ok(Math.abs(rec.lostUntil - (Date.now() + 14 * 86_400_000)) < 5000);
  kv.m.set(`lf:tag:${ID}`, JSON.stringify({ ...rec, lostUntil: Date.now() - 1000 }));
  assert.doesNotMatch(await (await call(env, `/found/${ID}`)).text(), /reported LOST/);
  await post(env, `/manage/${ID}/${secret}/lost`, {});
  assert.match(await (await call(env, `/found/${ID}`)).text(), /reported LOST/);
  await post(env, `/manage/${ID}/${secret}/found`, {});
  assert.doesNotMatch(await (await call(env, `/found/${ID}`)).text(), /reported LOST/);
});

test("update and delete removes all keys", async () => {
  const { kv, env, secret } = await claimed();
  const up = await post(env, `/manage/${ID}/${secret}/update`, claimBody({ name: "Max", phone: "+44 7000 000000" }));
  assert.match(await up.text(), /Saved/);
  kv.m.set(`lf:rl:${ID}:reveal:1`, "1");
  assert.equal((await post(env, `/manage/${ID}/${secret}/delete`, {})).status, 400);
  await post(env, `/manage/${ID}/${secret}/delete`, { confirm: "yes" });
  assert.equal(kv.m.size, 0);
});

test("UK numbers normalise for tel/wa.me/sms (server and browser)", () => {
  for (const n of ["07123 456789", "+44 7123 456789", "+44 (0)7123 456789", "00447123456789"]) {
    assert.equal(normalisePhone(n), "+447123456789");
  }
  assert.equal(normalisePhone("12345"), null);
  const vkLinks = new Function(`${LINKS_JS}; return vkLinks;`)();
  for (const n of ["07123 456789", "+447123456789"]) {
    const l = vkLinks(n, "Rex", "pet", { lat: "51.5", lng: "-0.1" });
    assert.equal(l.call, "tel:+447123456789");
    assert.ok(l.whatsapp.startsWith("https://wa.me/447123456789?text="));
    assert.ok(l.sms.startsWith("sms:+447123456789?body="));
    assert.ok(decodeURIComponent(l.sms).includes("https://maps.google.com/?q=51.5,-0.1"));
  }
  assert.ok(!new Function(`${LINKS_JS}; return vkLinks;`)()("07123456789", "Rex", "pet", null).sms.includes("maps"));
});
