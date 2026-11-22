const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(`${__dirname}/submissions.js`, 'utf8').replace(/^export /gm, '');

function createApp() {
  const records = new Map([
    ['sub_100_a', JSON.stringify({ _timestamp: '2026-01-01T00:00:00Z', parent_name: 'Alex', child_name: 'Sam', email: 'alex@example.com', keywords: 'private' })],
    ['sub_101_b', JSON.stringify({ _timestamp: '2026-01-02T00:00:00Z', parent_name: 'Taylor' })],
    ['rsvp:reply', '{"name":"Guest"}'],
    ['index_submissions', JSON.stringify([{ id: 'sub_100_a', child_name: 'Sam' }, { id: 'sub_101_b' }])]
  ]);
  const context = { Response, URL, console };
  runInNewContext(source, context);
  const env = {
    FORM_VIEWER_SECRET: 'secret',
    FORM_SUBMISSIONS: {
      async get(key) { return records.get(key) || null; },
      async put(key, value) { records.set(key, value); },
      async delete(key) { records.delete(key); },
      async list(options) {
        assert.equal(options.prefix, 'sub_');
        assert.equal(options.limit, 50);
        const keys = [...records.keys()].filter(key => key.startsWith(options.prefix));
        const offset = options.cursor ? Number(options.cursor) : 0;
        // Use a small mock page to exercise cursor handling.
        const page = keys.slice(offset, offset + 1);
        const next = offset + page.length;
        return { keys: page.map(name => ({ name })), list_complete: next >= keys.length, cursor: String(next) };
      }
    }
  };
  async function request(method, query = '', secret = 'secret') {
    const handler = method === 'DELETE' ? context.onRequestDelete : context.onRequestGet;
    return handler({
      request: new Request(`https://vi-key.uk/api/submissions${query}`, {
        method, headers: { 'x-form-viewer-secret': secret }
      }),
      env
    });
  }
  return { records, env, request };
}

test('lists actual Santa records in pages without exposing unrelated KV records', async () => {
  const app = createApp();
  const first = await app.request('GET');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const page = await first.json();
  assert.equal(page.submissions.length, 1);
  assert.deepEqual(page.submissions[0], {
    id: 'sub_100_a', timestamp: '2026-01-01T00:00:00Z', parent_name: 'Alex',
    child_name: 'Sam', email: 'alex@example.com'
  });
  assert.equal(page.cursor, '1');
  const next = await (await app.request('GET', '?cursor=1')).json();
  assert.equal(next.submissions[0].id, 'sub_101_b');
  assert.equal(next.cursor, null);
});

test('reads and deletes only authorized Santa records, including legacy index entries', async () => {
  const app = createApp();
  assert.equal((await app.request('GET', '', 'wrong')).status, 401);
  assert.equal((await app.request('DELETE', '?id=sub_100_a', 'wrong')).status, 401);
  assert.equal((await app.request('GET', '?id=rsvp%3Areply')).status, 400);
  assert.equal((await app.request('DELETE', '?id=rsvp%3Areply')).status, 400);
  assert.equal((await (await app.request('GET', '?id=sub_100_a')).json()).keywords, 'private');
  assert.equal((await app.request('DELETE', '?id=sub_100_a')).status, 200);
  assert.equal((await app.request('GET', '?id=sub_100_a')).status, 404);
  assert.deepEqual(JSON.parse(app.records.get('index_submissions')), [{ id: 'sub_101_b' }]);
  assert.ok(app.records.has('rsvp:reply'));
});

test('reports index and storage failures instead of claiming deletion succeeded', async () => {
  const app = createApp();
  app.records.set('index_submissions', 'invalid');
  assert.equal((await app.request('DELETE', '?id=sub_100_a')).status, 503);
  assert.ok(app.records.has('sub_100_a'));
  app.env.FORM_SUBMISSIONS = undefined;
  assert.equal((await app.request('GET')).status, 503);
  assert.equal((await app.request('DELETE', '?id=sub_100_a')).status, 503);
});

test('viewer escapes submitted text and reports a failed deletion', async () => {
  const html = readFileSync(`${__dirname}/../../xmas/submissions.html`, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, innerHTML: '', textContent: '', value: '',
      classList: { add() {}, remove() {} },
      addEventListener() {}
    });
    return elements.get(id);
  }
  const alerts = [];
  const context = {
    document: { getElementById: element },
    window: { location: { search: '' } },
    URLSearchParams,
    confirm: () => true,
    alert: message => alerts.push(message),
    fetch: async (url, options) => {
      if (options.method === 'DELETE') return new Response('{}', { status: 503 });
      return Response.json({ '<img src=x>': '<script>bad()</script>' });
    }
  };
  runInNewContext(script, context);
  context.renderTable([{ id: 'sub_100_a', timestamp: '2026-01-01', parent_name: '<img src=x>' }]);
  assert.match(element('tableBody').innerHTML, /&lt;img src=x&gt;/);
  assert.doesNotMatch(element('tableBody').innerHTML, /<img src=x>/);
  await context.viewDetail('sub_100_a');
  assert.match(element('modalContent').innerHTML, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(element('modalContent').innerHTML, /<script>/);
  await context.deleteSub('sub_100_a');
  assert.deepEqual(alerts, ['Failed to delete']);
});
