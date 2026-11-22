const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

async function sha32(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function loadApi(path) {
  const authSource = readFileSync(`${__dirname}/../lib/auth.js`, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '');
  const authContext = { crypto, TextEncoder, Uint8Array, Date, URL };
  runInNewContext(authSource, authContext);
  const source = readFileSync(`${__dirname}/api/${path}`, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '');
  const context = {
    Response,
    URL,
    crypto,
    TextEncoder,
    Uint8Array,
    validateXmasAdminCookie: authContext.validateXmasAdminCookie,
    validateXmasPageCookie: authContext.validateXmasPageCookie,
    validateSameOriginMutation: authContext.validateSameOriginMutation,
    santaExpirationTtl: () => 60,
    hashPassword: async value => `hashed:${value}`,
    verifyPassword: async (plain, hash) => hash === `hashed:${plain}`
  };
  runInNewContext(source, context);
  return context.onRequestPost;
}

function request(handler, body, env, cookie = '', extraHeaders = {}) {
  return handler({
    request: new Request('https://vi-key.uk/xmasletters/api/test', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...extraHeaders
      },
      body: JSON.stringify(body)
    }),
    env
  });
}

test('Santa letter mutations reject direct calls without the admin cookie', async () => {
  const contentPost = await loadApi('content.js');
  const passwordPost = await loadApi('password.js');
  const maps = {
    PAGE_PASSWORDS: new Map([['__admin__', 'stored-admin-hash']]),
    XMAS_CONTENT: new Map()
  };
  const env = {
    PAGE_PASSWORDS: {
      async get(key) { return maps.PAGE_PASSWORDS.get(key) || null; },
      async put(key, value) { maps.PAGE_PASSWORDS.set(key, value); },
      async delete(key) { maps.PAGE_PASSWORDS.delete(key); }
    },
    XMAS_CONTENT: {
      async get(key) { return maps.XMAS_CONTENT.get(key) || null; },
      async put(key, value) { maps.XMAS_CONTENT.set(key, value); },
      async delete(key) { maps.XMAS_CONTENT.delete(key); },
      async list() { return { keys: [] }; }
    }
  };

  assert.equal((await request(contentPost, { action: 'set-content', id: 'child', text: 'Hello' }, env)).status, 401);
  assert.equal((await request(passwordPost, { action: 'set', id: 'child', password: 'secret' }, env)).status, 401);
  assert.equal((await request(contentPost, { action: 'list-content' }, env)).status, 401);

  const cookieValue = await sha32('__admin__:stored-admin-hash');
  const cookie = `auth___admin__=${cookieValue}`;
  assert.equal((await request(contentPost, { action: 'set-content', id: 'child', text: 'Hello' }, env, cookie)).status, 200);
  assert.equal((await request(passwordPost, { action: 'set', id: 'child', password: 'secret' }, env, cookie)).status, 200);
  assert.equal((await request(contentPost, { action: 'delete-content', id: 'child' }, env, cookie)).status, 200);
});

test('Santa public letter reads remain available', async () => {
  const contentPost = await loadApi('content.js');
  const env = {
    PAGE_PASSWORDS: { async get() { return null; } },
    XMAS_CONTENT: {
      async get() { return JSON.stringify({ text: 'Public letter' }); }
    }
  };
  const response = await request(contentPost, { action: 'get-content', id: 'child' }, env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content.text, 'Public letter');
});

test('Santa protected letter content rejects direct API reads', async () => {
  const contentPost = await loadApi('content.js');
  const storedHash = 'page-password-hash';
  const env = {
    PAGE_PASSWORDS: {
      async get(key) { return key === 'child' ? storedHash : null; }
    },
    XMAS_CONTENT: {
      async get() { return JSON.stringify({ text: 'Private letter' }); }
    }
  };

  assert.equal((await request(
    contentPost,
    { action: 'get-content', id: 'child' },
    env
  )).status, 401);

  const cookieValue = await sha32('child:' + storedHash);
  const allowed = await request(
    contentPost,
    { action: 'get-content', id: 'child' },
    env,
    `auth_child=${cookieValue}`
  );
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).content.text, 'Private letter');
});

test('Santa mutations reject cross-origin and cross-site requests', async () => {
  const contentPost = await loadApi('content.js');
  const passwordPost = await loadApi('password.js');
  const env = {
    PAGE_PASSWORDS: { async get() { return 'stored-admin-hash'; } },
    XMAS_CONTENT: {
      async get() { return null; },
      async put() {},
      async delete() {},
      async list() { return { keys: [] }; }
    }
  };
  const cookieValue = await sha32('__admin__:stored-admin-hash');
  const cookie = `auth___admin__=${cookieValue}`;

  assert.equal((await request(
    contentPost,
    { action: 'set-content', id: 'child', text: 'Hello' },
    env,
    cookie,
    { origin: 'https://evil.example' }
  )).status, 403);
  assert.equal((await request(
    passwordPost,
    { action: 'set', id: 'child', password: 'secret' },
    env,
    cookie,
    { 'sec-fetch-site': 'cross-site' }
  )).status, 403);
  assert.equal((await request(
    contentPost,
    { action: 'set-content', id: 'child', text: 'Hello' },
    env,
    cookie,
    { origin: 'https://vi-key.uk' }
  )).status, 200);
});
