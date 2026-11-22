const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const authSource = readFileSync(`${__dirname}/../lib/auth.js`, 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');
const auth = { Date, Uint8Array };
runInNewContext(authSource, auth);

const source = readFileSync(`${__dirname}/admin.js`, 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');

function createApp() {
  const stock = new Map();
  const sessions = new Map([
    ['valid-admin', JSON.stringify({ userId: '__admin__', expiresAt: Date.now() + 60_000 })]
  ]);
  const env = {
    STOCK_KV: {
      async get(key) { return stock.get(key) ?? null; },
      async put(key, value) { stock.set(key, value); }
    },
    ADMIN_SESSIONS: {
      async get(key) { return sessions.get(key) || null; },
      async delete(key) { sessions.delete(key); }
    }
  };
  const context = {
    Response,
    URL,
    validateSession: auth.validateSession
  };
  runInNewContext(source, context);
  return { env, stock, async get(query = '', token = '') {
    return context.onRequestGet({
      request: new Request(`https://vi-key.uk/api/admin${query}`, {
        headers: { 'x-admin-session': token }
      }),
      env
    });
  } };
}

test('stock admin requires a live admin session', async () => {
  const app = createApp();
  assert.equal((await app.get()).status, 401);
  assert.equal((await app.get('?action=reset', 'invalid')).status, 401);

  assert.equal((await app.get('', 'valid-admin')).status, 200);
  assert.equal((await app.get('?action=set&tag=tag1&value=7', 'valid-admin')).status, 200);
  assert.equal(app.stock.get('stock:tag1'), '7');
  assert.equal((await app.get('?action=setall&value=20', 'valid-admin')).status, 200);
  assert.equal(app.stock.size, 6);
});

test('stock admin rejects unknown tags and stock pages contain no hardcoded credentials', () => {
  const app = createApp();
  return app.get('?action=set&tag=../../private&value=7', 'valid-admin').then(response => {
    assert.equal(response.status, 400);
  }).then(() => {
    const html = readFileSync(`${__dirname}/../../stock-admin/index.html`, 'utf8');
    assert.doesNotMatch(html, /Qnwbevrctxyz123|secret=|GATE_PASSWORD/);
  });
});
