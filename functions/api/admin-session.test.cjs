const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const authContext = { crypto, TextEncoder, Uint8Array, Date, URL };
runInNewContext(readFileSync(`${__dirname}/../lib/auth.js`, 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export const /gm, 'var ').replace(/^export /gm, ''), authContext);

const handlerContext = {
  Response, URL, Date, Math,
  ADMIN_SESSION_COOKIE: 'admin_session',
  validateSession: authContext.validateSession,
  validateSameOriginMutation: authContext.validateSameOriginMutation
};
runInNewContext(readFileSync(`${__dirname}/admin-session.js`, 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export /gm, ''), handlerContext);

function env(userId = '__admin__') {
  const sessions = new Map([['tok', JSON.stringify({ userId, expiresAt: Date.now() + 60_000 })]]);
  return { ADMIN_SESSIONS: { async get(k) { return sessions.get(k) || null; }, async delete(k) { sessions.delete(k); } } };
}

function post(body, token, e = env()) {
  return handlerContext.onRequestPost({
    request: new Request('https://vi-key.uk/api/admin-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-session': token } : {}) },
      body: JSON.stringify(body)
    }),
    env: e
  });
}

test('start sets an HttpOnly cookie for a valid admin session', async () => {
  const res = await post({ action: 'start' }, 'tok');
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^admin_session=tok;/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
});

test('start rejects missing or non-admin sessions', async () => {
  assert.equal((await post({ action: 'start' }, 'nope')).status, 401);
  assert.equal((await post({ action: 'start' }, 'tok', env('someone'))).status, 401);
});

test('end clears the cookie', async () => {
  const res = await post({ action: 'end' });
  assert.match(res.headers.get('set-cookie'), /^admin_session=; .*Max-Age=0/);
});

test('shared cookie authorises xmas admin checks', async () => {
  const request = cookie => new Request('https://vi-key.uk/x', { headers: { cookie } });
  assert.ok(await authContext.validateXmasAdminCookie(env(), request('admin_session=tok')));
  assert.equal(await authContext.validateXmasAdminCookie(env(), request('admin_session=bad')), null);
});
