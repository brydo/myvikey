const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const authSource = readFileSync(`${__dirname}/../lib/auth.js`, 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');

function createAuth() {
  const context = {
    bcrypt: { compare: async (password, hash) => password === hash },
    Date,
    Uint8Array
  };
  runInNewContext(authSource, context);
  return context;
}

function createApp(contentPath, passwordPath) {
  const auth = createAuth();
  const passwords = new Map([['protected-page', 'correct-password']]);
  const content = new Map([
    ['protected-page', JSON.stringify({ text: 'Private memorial' })],
    ['public-page', JSON.stringify({ text: 'Public memorial' })]
  ]);
  const rateLimits = new Map();
  const sessions = new Map([[
    'admin-session',
    JSON.stringify({ userId: '__admin__', expiresAt: Date.now() + 60_000 })
  ]]);
  const kv = (map) => ({
    async get(key) { return map.get(key) || null; },
    async put(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    async list() { return { keys: [...map.keys()].map((name) => ({ name })) }; }
  });
  const env = {
    MEMORIAL_PASSWORDS: kv(passwords),
    MEMORIAL_CONTENT: kv(content),
    PET_PASSWORDS: kv(passwords),
    PET_CONTENT: kv(content),
    RATE_LIMIT: kv(rateLimits),
    ADMIN_SESSIONS: kv(sessions)
  };
  const globals = {
    Response,
    Date,
    validateSession: auth.validateSession,
    verifyPagePassword: auth.verifyPagePassword,
    checkRateLimit: auth.checkRateLimit,
    recordFailedAttempt: auth.recordFailedAttempt,
    verifyPassword: auth.verifyPassword,
    createSession: auth.createSession,
    generateSessionToken: auth.generateSessionToken,
    hashPassword: auth.hashPassword
  };
  const load = (path) => {
    const source = readFileSync(`${__dirname}/${path}`, 'utf8')
      .replace(/^import .*$/gm, '')
      .replace(/^export /gm, '');
    const context = { ...globals };
    runInNewContext(source, context);
    return context.onRequestPost;
  };
  const contentPost = load(contentPath);
  const passwordPost = load(passwordPath);

  async function post(handler, fields, headers = {}) {
    return handler({
      request: new Request('https://vi-key.uk/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.10', ...headers },
        body: JSON.stringify(fields)
      }),
      env
    });
  }

  return {
    env,
    postContent: (fields, headers) => post(contentPost, fields, headers),
    postPassword: (fields, headers) => post(passwordPost, fields, headers)
  };
}

for (const [label, contentPath, passwordPath] of [
  ['memorial', 'content.js', 'password.js'],
  ['pet memorial', 'pet-content.js', 'pet-password.js']
]) {
  test(`${label} content requires the page password and admin-only listing`, async () => {
    const app = createApp(contentPath, passwordPath);

    assert.equal((await app.postContent({ action: 'get-content', id: 'protected-page' })).status, 401);
    assert.equal((await app.postContent({
      action: 'get-content', id: 'protected-page', password: 'wrong'
    })).status, 401);

    const allowed = await app.postContent({
      action: 'get-content', id: 'protected-page', password: 'correct-password'
    });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).content.text, 'Private memorial');

    assert.equal((await app.postContent({ action: 'list-content' })).status, 401);
    assert.equal((await app.postContent(
      { action: 'list-content' }, { 'x-admin-session': 'admin-session' }
    )).status, 200);
    assert.equal((await app.postContent({ action: 'get-content', id: 'public-page' })).status, 200);
  });

  test(`${label} page-password checks lock after repeated failures`, async () => {
    const app = createApp(contentPath, passwordPath);
    const results = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      results.push(await app.postPassword({
        action: 'verify', id: 'protected-page', password: 'wrong'
      }));
    }

    assert.deepEqual(results.map((response) => response.status), [401, 401, 429, 429]);
    assert.ok(Number(results[2].headers.get('retry-after')) > 0);
  });

  test(`${label} direct content requests also enforce the failed-password lock`, async () => {
    const app = createApp(contentPath, passwordPath);
    const results = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      results.push(await app.postContent({
        action: 'get-content', id: 'protected-page', password: 'wrong'
      }));
    }

    assert.deepEqual(results.map((response) => response.status), [401, 401, 429, 429]);
    assert.ok(Number(results[2].headers.get('retry-after')) > 0);
  });
}
