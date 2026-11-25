const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const strip = (path) => readFileSync(`${__dirname}/${path}`, 'utf8')
  .replace(/^import [\s\S]*?;$/gm, '').replace(/^export /gm, '');

function createApp() {
  const kv = () => { const m = new Map(); return { m,
    async get(k) { return m.get(k) ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
  const env = { CARD_PASSWORDS: kv(), CARD_CONTENT: kv(), RATE_LIMIT: kv(), ADMIN_SESSIONS: kv(), RESEND_API_KEY: 'key' };
  env.ADMIN_SESSIONS.m.set('admin', JSON.stringify({ userId: '__admin__', expiresAt: Date.now() + 60_000 }));
  env.CARD_CONTENT.m.set('anna', JSON.stringify({ name: 'Anna' }));
  env.CARD_CONTENT.m.set('bob', JSON.stringify({ name: 'Bob' }));
  const emails = [];
  const ctx = { Response, URL, Date, Math, TextEncoder, Uint8Array, crypto, console,
    fetch: async (_url, init) => { emails.push(JSON.parse(init.body)); return { ok: true }; } };
  runInNewContext(strip('../lib/card-owner.js'), ctx);
  ctx.hashPassword = async (p) => 'h:' + p;
  ctx.verifyPassword = async (p, h) => h === 'h:' + p;
  ctx.validateSession = async (e, t) => {
    const raw = await e.ADMIN_SESSIONS.get(t); return raw ? JSON.parse(raw) : null;
  };
  runInNewContext(strip('card-owner.js'), ctx);
  const content = { ...ctx };
  runInNewContext(strip('card-content.js'), content);
  const call = (fn, path, body, headers = {}) => fn({ env, request: new Request('https://vi-key.uk/api/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...headers },
    body: JSON.stringify(body) }) });
  const owner = (body, headers) => call(ctx.onRequestPost, 'card-owner', body, headers);
  const card = (body, headers) => call(content.onRequestPost, 'card-content', body, headers);
  const tokenFrom = (i) => emails[i].html.match(/[?](?:verify|reset)=([0-9a-f]{64})/)[1];
  return { env, emails, owner, card, tokenFrom };
}

async function claimed(app, id = 'anna', email = 'anna@example.com', password = 'secret-pass') {
  const { code } = await (await app.owner({ action: 'create-claim', id }, { 'x-admin-session': 'admin' })).json();
  assert.equal((await app.owner({ action: 'claim', id, code, email, password })).status, 200);
  const token = app.tokenFrom(app.emails.length - 1);
  assert.equal((await app.owner({ action: 'verify-email', token })).status, 200);
  return code;
}

async function login(app, id = 'anna', password = 'secret-pass') {
  const res = await app.owner({ action: 'login', id, password });
  return res.status === 200 ? (await res.json()).sessionToken : null;
}

test('claim, confirm email, sign in and edit own card; claim code is single use', async () => {
  const app = createApp();
  const code = await claimed(app);
  assert.equal(app.emails[0].to, 'anna@example.com');
  const session = await login(app);
  assert.ok(session);
  const saved = await app.card({ action: 'set-content', id: 'anna', name: 'Anna Smith' }, { 'x-owner-session': session });
  assert.equal(saved.status, 200);
  const got = await (await app.card({ action: 'get-content', id: 'anna' }, { 'x-owner-session': session })).json();
  assert.equal(got.content.name, 'Anna Smith');
  assert.equal((await app.owner({ action: 'claim', id: 'anna', code, email: 'x@example.com', password: 'another-pass' })).status, 401);
});

test('an account is not created until the email link is used, and wrong codes are refused', async () => {
  const app = createApp();
  const { code } = await (await app.owner({ action: 'create-claim', id: 'anna' }, { 'x-admin-session': 'admin' })).json();
  assert.equal((await app.owner({ action: 'claim', id: 'anna', code: 'AAAA-AAAA-AAAA-AAAA', email: 'a@example.com', password: 'secret-pass' })).status, 401);
  assert.equal((await app.owner({ action: 'claim', id: 'anna', code, email: 'a@example.com', password: 'secret-pass' })).status, 200);
  assert.equal(await login(app), null);
});

test('an owner cannot edit another card, list cards or use owner sessions as admin', async () => {
  const app = createApp();
  await claimed(app);
  const session = await login(app);
  const h = { 'x-owner-session': session };
  assert.equal((await app.card({ action: 'set-content', id: 'bob', name: 'Hacked' }, h)).status, 401);
  assert.equal((await app.card({ action: 'delete-content', id: 'anna' }, h)).status, 401);
  assert.equal((await app.card({ action: 'list-content' }, h)).status, 401);
  assert.equal((await app.owner({ action: 'create-claim', id: 'bob' }, { 'x-admin-session': session })).status, 401);
  assert.equal(app.env.ADMIN_SESSIONS.m.has(session), false);
});

test('only admins can create claim codes', async () => {
  const app = createApp();
  assert.equal((await app.owner({ action: 'create-claim', id: 'anna' })).status, 401);
  assert.equal((await app.owner({ action: 'create-claim', id: 'nobody' }, { 'x-admin-session': 'admin' })).status, 400);
});

test('reset email goes only to the registered address and the link works once', async () => {
  const app = createApp();
  await claimed(app);
  const before = app.emails.length;
  await app.owner({ action: 'forgot', id: 'anna', email: 'attacker@example.com' });
  const unknown = await app.owner({ action: 'forgot', id: 'nobody', email: 'anna@example.com' });
  assert.equal(app.emails.length, before);
  assert.equal(unknown.status, 200);
  const old = await login(app);
  await app.owner({ action: 'forgot', id: 'anna', email: 'Anna@Example.com' });
  assert.equal(app.emails.length, before + 1);
  assert.equal(app.emails[before].to, 'anna@example.com');
  const token = app.tokenFrom(before);
  assert.equal((await app.owner({ action: 'reset', token, password: 'new-secret-pass' })).status, 200);
  assert.equal((await app.owner({ action: 'reset', token, password: 'third-secret-pass' })).status, 400);
  assert.equal(await login(app), null);
  assert.ok(await login(app, 'anna', 'new-secret-pass'));
  assert.equal((await app.card({ action: 'set-content', id: 'anna', name: 'X' }, { 'x-owner-session': old })).status, 401);
});

test('login is locked after repeated failures', async () => {
  const app = createApp();
  await claimed(app);
  for (let i = 0; i < 8; i++) assert.equal((await app.owner({ action: 'login', id: 'anna', password: 'wrong-pass' })).status, 401);
  assert.equal((await app.owner({ action: 'login', id: 'anna', password: 'secret-pass' })).status, 429);
});

test('weak passwords and cross-origin requests are rejected', async () => {
  const app = createApp();
  const { code } = await (await app.owner({ action: 'create-claim', id: 'anna' }, { 'x-admin-session': 'admin' })).json();
  assert.equal((await app.owner({ action: 'claim', id: 'anna', code, email: 'a@example.com', password: 'short' })).status, 400);
  assert.equal((await app.owner({ action: 'login', id: 'anna', password: 'x' }, { origin: 'https://evil.example' })).status, 403);
});
