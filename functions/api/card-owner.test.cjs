const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const strip = (path) => readFileSync(`${__dirname}/${path}`, 'utf8')
  .replace(/^import [\s\S]*?;$/gm, '').replace(/^export /gm, '');

function createApp() {
  const kv = () => { const m = new Map(); return { m,
    async get(k) { return m.get(k) ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } }; };
  const env = { CARD_PASSWORDS: kv(), CARD_CONTENT: kv(), RATE_LIMIT: kv(), ADMIN_SESSIONS: kv(), RESEND_API_KEY: 'key' };
  env.ADMIN_SESSIONS.m.set('admin', JSON.stringify({ userId: '__admin__', expiresAt: Date.now() + 60_000 }));
  env.CARD_CONTENT.m.set('anna', JSON.stringify({ name: 'Anna' }));
  env.CARD_CONTENT.m.set('bob', JSON.stringify({ name: 'Bob' }));
  const emails = [];
  const sent = emails;
  const ctx = { Response, URL, Date, Math, TextEncoder, Uint8Array, crypto, console, btoa, atob,
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
  const images = { ...ctx };
  runInNewContext(strip('card-image.js'), images);
  const image = (method, query, body, headers = {}) => images['onRequest' + method[0] + method.slice(1).toLowerCase()]({ env, request: new Request('https://vi-key.uk/api/card-image?' + query, {
    method, headers: { 'cf-connecting-ip': '1.1.1.1', ...headers }, body }) });
  const call = (fn, path, body, headers = {}) => fn({ env, request: new Request('https://vi-key.uk/api/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...headers },
    body: JSON.stringify(body) }) });
  const owner = (body, headers) => call(ctx.onRequestPost, 'card-owner', body, headers);
  const card = (body, headers) => call(content.onRequestPost, 'card-content', body, headers);
  const tokenFrom = (i) => emails[i].html.match(/[?](?:verify|reset)=([0-9a-f]{64})/)[1];
  return { env, emails, owner, card, image, tokenFrom };
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

test('admin can issue a code for a new blank card and the owner adds all details', async () => {
  const app = createApp();
  const issued = await (await app.owner({ action: 'create-claim' }, { 'x-admin-session': 'admin' })).json();
  assert.match(issued.id, /^card-[0-9a-f]{8}$/);
  assert.equal(await app.env.CARD_CONTENT.get(issued.id), null);
  const mail = app.emails.length;
  assert.equal((await app.owner({ action: 'claim', id: issued.id, code: issued.code, email: 'new@example.com', password: 'secret-pass' })).status, 200);
  assert.equal((await app.owner({ action: 'verify-email', token: app.tokenFrom(mail) })).status, 200);
  const session = await login(app, issued.id);
  const saved = await app.card({ action: 'set-content', id: issued.id, name: 'New Owner', phone: '+44 7700 900123' }, { 'x-owner-session': session });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(await app.env.CARD_CONTENT.get(issued.id)).name, 'New Owner');
});

test('batch creates unique blank cards, emails the list and codes never expire', async () => {
  const app = createApp();
  const res = await (await app.owner({ action: 'create-batch', count: 3 }, { 'x-admin-session': 'admin' })).json();
  assert.equal(res.cards.length, 3);
  assert.equal(new Set(res.cards.map(c => c.id)).size, 3);
  assert.equal(res.emailed, true);
  assert.equal(res.emailedTo, 'brydo@outlook.com');
  const mail = app.emails[0];
  assert.equal(mail.to, 'brydo@outlook.com');
  for (const c of res.cards) {
    assert.ok(mail.html.includes(c.code) && mail.html.includes(c.url));
    assert.ok(Buffer.from(mail.attachments[0].content, 'base64').toString().includes(c.code));
    assert.equal(app.env.CARD_PASSWORDS.m.get('claim:' + c.id).includes(c.code), false);
  }
  const claimEmail = app.emails.length;
  assert.equal((await app.owner({ action: 'claim', id: res.cards[0].id, code: res.cards[0].code.toLowerCase(), email: 'a@example.com', password: 'secret-pass' })).status, 200);
  assert.equal(app.emails.length, claimEmail + 1);
});

test('batch size is limited, admin only, and BATCH_EMAIL_TO overrides the address', async () => {
  const app = createApp();
  const admin = { 'x-admin-session': 'admin' };
  assert.equal((await app.owner({ action: 'create-batch', count: 0 }, admin)).status, 400);
  assert.equal((await app.owner({ action: 'create-batch', count: 101 }, admin)).status, 400);
  assert.equal((await app.owner({ action: 'create-batch', count: 1.5 }, admin)).status, 400);
  assert.equal((await app.owner({ action: 'create-batch', count: 2 })).status, 401);
  app.env.BATCH_EMAIL_TO = 'other@example.com';
  await app.owner({ action: 'create-batch', count: 1 }, admin);
  assert.equal(app.emails.at(-1).to, 'other@example.com');
});

test('admin lists claimed and unclaimed cards without exposing codes; reissue replaces the old code', async () => {
  const app = createApp();
  const admin = { 'x-admin-session': 'admin' };
  await claimed(app);
  const batch = await (await app.owner({ action: 'create-batch', count: 2 }, admin)).json();
  const list = await (await app.owner({ action: 'list-owners' }, admin)).json();
  assert.deepEqual(list.claimed.map(c => [c.id, c.email]), [['anna', 'anna@example.com']]);
  assert.equal(list.unclaimed.length, 2);
  assert.equal(JSON.stringify(list).includes(batch.cards[0].code), false);
  assert.equal((await app.owner({ action: 'list-owners' })).status, 401);
  const old = batch.cards[0];
  const fresh = await (await app.owner({ action: 'create-claim', id: old.id }, admin)).json();
  assert.equal((await app.owner({ action: 'claim', id: old.id, code: old.code, email: 'a@example.com', password: 'secret-pass' })).status, 401);
  assert.equal((await app.owner({ action: 'claim', id: old.id, code: fresh.code, email: 'a@example.com', password: 'secret-pass' })).status, 200);
});

// SOI, JFIF, an EXIF (GPS) segment, a comment, 10x10 frame header, then scan data.
const jpeg = (w = 10, h = 10) => Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46,
  0xff, 0xe1, 0, 8, 0x47, 0x50, 0x53, 0x21, 0x21, 0x21,
  0xff, 0xfe, 0, 4, 0x68, 0x69,
  0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0,
  0xff, 0xda, 0, 4, 1, 0, 0x12, 0x34, 0xff, 0xd9]);

test('owner uploads photo and logo; metadata is stripped and the card links to them', async () => {
  const app = createApp();
  await claimed(app);
  const session = await login(app);
  const h = { 'x-owner-session': session, 'content-type': 'image/jpeg' };
  assert.equal((await app.image('POST', 'id=anna&kind=photo', jpeg(), h)).status, 200);
  assert.equal((await app.image('POST', 'id=anna&kind=logo', jpeg(), h)).status, 200);
  const stored = Buffer.from(app.env.CARD_PASSWORDS.m.get('image:photo:anna'), 'base64');
  assert.equal(stored.includes(Buffer.from('GPS!!!')), false);
  assert.equal(stored.includes(Buffer.from([0xff, 0xe1])), false);
  const served = await app.image('GET', 'id=anna&kind=photo');
  assert.equal(served.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), stored);
  // Saving details must not let the owner point at an outside image, and keeps their uploads.
  await app.card({ action: 'set-content', id: 'anna', name: 'Anna', photoUrl: 'https://evil.example/x.jpg' }, { 'x-owner-session': session });
  const c = JSON.parse(app.env.CARD_CONTENT.m.get('anna'));
  assert.match(c.photoUrl, /^https:\/\/vi-key\.uk\/api\/card-image\?id=anna&kind=photo/);
  assert.match(c.companyLogoUrl, /kind=logo/);
  assert.equal((await app.image('DELETE', 'id=anna&kind=photo', undefined, h)).status, 200);
  assert.equal((await app.image('GET', 'id=anna&kind=photo')).status, 404);
  assert.equal(JSON.parse(app.env.CARD_CONTENT.m.get('anna')).photoUrl, '');
});

test('image upload needs the owner of that card, a small JPEG and a sane size', async () => {
  const app = createApp();
  await claimed(app);
  const session = await login(app);
  const h = { 'x-owner-session': session };
  assert.equal((await app.image('POST', 'id=anna&kind=photo', jpeg())).status, 401);
  assert.equal((await app.image('POST', 'id=bob&kind=photo', jpeg(), h)).status, 401);
  assert.equal((await app.image('POST', 'id=anna&kind=photo', Buffer.from('<svg onload=1>'), h)).status, 400);
  assert.equal((await app.image('POST', 'id=anna&kind=photo', jpeg(5000, 5000), h)).status, 400);
  assert.equal((await app.image('POST', 'id=anna&kind=photo', Buffer.alloc(250001, 1), h)).status, 413);
  assert.equal((await app.image('POST', 'id=anna&kind=banner', jpeg(), h)).status, 400);
  assert.equal((await app.image('POST', 'id=anna&kind=photo', jpeg(), { ...h, origin: 'https://evil.example' })).status, 403);
});

test('admin can remove an owner-uploaded image; other people cannot', async () => {
  const app = createApp();
  await claimed(app);
  const session = await login(app);
  await app.image('POST', 'id=anna&kind=photo', jpeg(), { 'x-owner-session': session });
  assert.equal((await app.image('DELETE', 'id=anna&kind=photo')).status, 401);
  const removed = await app.image('DELETE', 'id=anna&kind=photo', undefined, { 'x-admin-session': 'admin' });
  assert.equal(removed.status, 200);
  assert.equal((await app.image('GET', 'id=anna&kind=photo')).status, 404);
  const put = await (await app.image('POST', 'id=anna&kind=logo', jpeg(), { 'x-admin-session': 'admin' })).json();
  assert.match(put.url, /kind=logo/);
});
