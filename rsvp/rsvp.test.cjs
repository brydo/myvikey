const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');

const valid = { action: 'submit', name: ' Alex ', event: ' Celebration ', attending: 'yes', guests: 2, notes: ' Hello\nthere ' };

function api() {
    const records = new Map();
    const calls = [];
    const env = {
        FORM_SUBMISSIONS: {
            put: async (key, value) => records.set(key, value),
            get: async key => records.get(key),
            list: async options => {
                calls.push(options);
                return {
                    keys: [...records.keys()].filter(key => key.startsWith(options.prefix)).map(name => ({ name })),
                    list_complete: false, cursor: 'next-page'
                };
            }
        }
    };
    const context = {
        URL, Response, crypto: webcrypto,
        validateSession: async (_, token) => token === 'valid-session' ? { userId: '__admin__' } : null
    };
    const source = readFileSync(`${__dirname}/../functions/api/rsvp.js`, 'utf8')
        .replace(/^import .*;\n/, '')
        .replace('export async function', 'async function');
    runInNewContext(source, context);
    return {
        env, records, calls,
        post: (body, token, url = 'https://example.com/api/rsvp') => context.onRequestPost({
            env,
            request: new Request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Session': token } : {}) },
                body: JSON.stringify(body)
            })
        })
    };
}

test('stores exactly the five RSVP fields, trims text, and gives each response its own key', async () => {
    const { post, records } = api();
    for (let i = 0; i < 2; i++) {
        const result = await post({ ...valid, phone: 'ignored', email: 'ignored', id: 'ignored' });
        assert.equal(result.status, 200);
        assert.equal(result.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(records.size, 2);
    for (const [key, raw] of records) {
        assert.match(key, /^rsvp:[0-9a-f-]{36}$/);
        assert.deepEqual(JSON.parse(raw), {
            name: 'Alex', event: 'Celebration', notes: 'Hello\nthere', attending: 'yes', guests: 2
        });
    }
});

test('accepts declining with no guests and optional or maximum-length notes', async () => {
    const { post } = api();
    assert.equal((await post({ ...valid, attending: 'no', guests: 0, notes: undefined })).status, 200);
    assert.equal((await post({ ...valid, guests: 100, notes: 'x'.repeat(1000) })).status, 200);
});

test('rejects malformed responses without writing to storage', async () => {
    const { post, records } = api();
    for (const body of [
        null, [], 'text', {}, { action: 'delete' },
        ...[
            { name: '' }, { name: '   ' }, { name: 1 }, { name: 'x'.repeat(101) },
            { event: '' }, { event: null }, { event: 'x'.repeat(101) },
            { notes: {} }, { notes: 'x'.repeat(1001) },
            { attending: 'maybe' }, { attending: true },
            { guests: -1 }, { guests: 1.5 }, { guests: '2' }, { guests: 101 },
            { attending: 'no', guests: 1 }
        ].map(fields => ({ ...valid, ...fields }))
    ]) {
        assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.equal(records.size, 0);
});

test('requires HTTPS, handles invalid JSON and reports storage failures honestly', async () => {
    const { post, env } = api();
    assert.equal((await post(valid, null, 'http://example.com/api/rsvp')).status, 403);
    const context = { URL, Response };
    runInNewContext(readFileSync(`${__dirname}/../functions/api/rsvp.js`, 'utf8')
        .replace(/^import .*;\n/, '').replace('export async function', 'async function'), context);
    const invalid = await context.onRequestPost({
        env, request: new Request('https://example.com/api/rsvp', { method: 'POST', body: '{' })
    });
    assert.equal(invalid.status, 400);
    env.FORM_SUBMISSIONS.put = async () => { throw new Error('private storage detail'); };
    const failed = await post(valid);
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /private storage detail/);
    delete env.FORM_SUBMISSIONS;
    assert.equal((await post(valid)).status, 503);
});

test('listing is admin-only, scoped to RSVP keys, paginated and never cached', async () => {
    const { post, records, calls } = api();
    await post(valid);
    records.set('sub_unrelated', '{"private":"order"}');
    for (const token of [undefined, 'invalid-session']) {
        assert.equal((await post({ action: 'list' }, token)).status, 401);
    }
    assert.equal(calls.length, 0);
    const result = await post({ action: 'list', cursor: 'previous-page' }, 'valid-session');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    const data = await result.json();
    assert.equal(data.responses.length, 1);
    assert.equal(data.responses[0].name, 'Alex');
    assert.equal(data.cursor, 'next-page');
    assert.equal(calls[0].prefix, 'rsvp:');
    assert.equal(calls[0].limit, 50);
    assert.equal(calls[0].cursor, 'previous-page');
    assert.equal((await post({ action: 'list', cursor: {} }, 'valid-session')).status, 400);
});

function element(tag) {
    return {
        tag, children: [], attributes: {}, textContent: '',
        appendChild(child) { this.children.push(child); },
        setAttribute(key, value) { this.attributes[key] = value; }
    };
}

test('shared renderer displays only RSVP fields as text, including hostile input', () => {
    const context = { window: {}, document: { createElement: element } };
    runInNewContext(readFileSync(`${__dirname}/card-render.js`, 'utf8'), context);
    const root = element('div');
    const hostile = '<img src=x onerror=alert(1)>';
    context.window.RSVP.render(root, { ...valid, name: hostile, notes: hostile, phone: 'ignored' });
    const card = root.children[0];
    assert.equal(card.className, 'rsvp-card');
    const fields = card.children[2].children;
    assert.deepEqual(fields.filter(node => node.tag === 'dt').map(node => node.textContent),
        ['Name', 'Event', 'Attending', 'Guests', 'Notes']);
    assert.equal(fields[1].textContent, hostile);
    assert.equal(fields[9].textContent, hostile);
    assert.equal(fields[5].textContent, 'Yes');
    assert.equal(fields[7].textContent, '2');
    assert.ok(fields.every(node => node.children.length === 0));
    const declined = element('div');
    context.window.RSVP.render(declined, { ...valid, attending: 'no', guests: 0, notes: '' });
    assert.equal(declined.children[0].children[2].children[5].textContent, 'No');
    assert.equal(declined.children[0].children[2].children[9].textContent, '—');
});

test('all three pages use shared RSVP assets and contain no contact functionality', () => {
    for (const page of ['index', 'admin', 'view']) {
        const html = readFileSync(`${__dirname}/${page}.html`, 'utf8');
        assert.match(html, /href="\/rsvp\/card\.css"/);
        assert.match(html, /src="\/rsvp\/card-render\.js"/);
        assert.match(html, /src="\/rsvp\/rsvp\.js"/);
        assert.doesNotMatch(html, /vcard|mailto:|tel:|whatsapp|facebook|instagram|linkedin/i);
    }
});
