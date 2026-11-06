const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');
const themesSource = readFileSync(`${__dirname}/themes.js`, 'utf8').replace(/^export /gm, '');
const idsSource = readFileSync(`${__dirname}/invitation-id.js`, 'utf8').replace(/^export /gm, '');
const apiSource = themesSource + '\n' + idsSource + '\n' + readFileSync(`${__dirname}/../functions/api/rsvp.js`, 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');

function api() {
    const records = new Map();
    let failures = 0;
    const env = {
        RATE_LIMIT: {},
        FORM_SUBMISSIONS: {
            put: async (key, value) => records.set(key, value),
            get: async key => records.get(key) || null,
            delete: async key => records.delete(key),
            list: async options => {
                const keys = [...records.keys()].filter(key => key.startsWith(options.prefix));
                const offset = Number(options.cursor) || 0;
                const end = offset + options.limit;
                return { keys: keys.slice(offset, end).map(name => ({ name })),
                    list_complete: end >= keys.length, cursor: end >= keys.length ? '' : String(end) };
            }
        }
    };
    const context = {
        URL, Response, TextEncoder, crypto: webcrypto,
        validateSession: async (_, token) => token === 'valid-session' ? { userId: '__admin__' } : null,
        hashPassword: async password => 'hash:' + password,
        verifyPassword: async (password, hash) => hash === 'hash:' + password,
        generateSessionToken: () => Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('hex'),
        checkRateLimit: async () => ({ allowed: failures < 5, lockedUntil: Date.now() + 60000 }),
        recordFailedAttempt: async () => ({ lockedUntil: ++failures >= 5 ? Date.now() + 60000 : 0 })
    };
    runInNewContext(apiSource, context);
    const post = (body, headers = {}) => context.onRequestPost({
        env, request: new Request('https://example.com/api/rsvp', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
        })
    });
    return { env, records, post };
}

const event = { action: 'save-invitation', eventType: 'weddings', title: 'Wedding', text: 'Join us', hostPassword: 'host-secret-1' };
const admin = { 'X-Admin-Session': 'valid-session' };

async function setup() {
    const instance = api();
    const save = async fields => (await (await instance.post({ ...event, ...fields }, admin)).json()).invitation;
    const first = await save({});
    const second = await save({ title: 'Other', hostPassword: 'other-secret-1' });
    for (const [invitation, name] of [[first, 'Ann'], [first, 'Bob'], [second, 'Cat']]) {
        const result = await instance.post({ action: 'submit', eventId: invitation.id, event: invitation.title,
            name, attending: 'yes', guests: 1, notes: 'n' });
        assert.equal(result.status, 200);
    }
    return { ...instance, first, second };
}

const login = (instance, id, password) => instance.post({ action: 'host-login', id, password });

test('host password is hashed, never returned, and only set by admins', async () => {
    const { first, records, post } = await setup();
    assert.equal(first.hostPasswordProtected, true);
    assert.doesNotMatch(JSON.stringify(first), /hash|host-secret/);
    assert.equal(JSON.parse(records.get('rsvp-invitation:' + first.id)).hostPasswordHash, 'hash:host-secret-1');
    assert.equal((await post({ ...event, id: first.id, hostPassword: 'hijack-pass-1' })).status, 401);
    assert.equal((await post({ ...event, id: first.id, hostPassword: 'short' }, admin)).status, 400);
    assert.equal((await post({ ...event, id: first.id, removeHostPassword: true }, admin)).status, 400);
});

test('host sees only their own event replies, with limited fields', async () => {
    const instance = await setup();
    const token = (await (await login(instance, instance.first.id, 'host-secret-1')).json()).hostToken;
    assert.match(token, /^[a-f0-9]{64}$/);
    const data = await (await instance.post({ action: 'host-list' }, { 'X-RSVP-Host-Token': token })).json();
    assert.deepEqual(data.responses.map(item => item.name).sort(), ['Ann', 'Bob']);
    assert.deepEqual(Object.keys(data.responses[0]).sort(), ['attending', 'createdAt', 'event', 'eventId', 'guests', 'name', 'notes']);
    assert.equal(data.invitation.id, instance.first.id);
    assert.doesNotMatch(JSON.stringify(data), /hash|Cat/);
});

test('host tokens cannot reach admin actions or other events', async () => {
    const instance = await setup();
    const token = (await (await login(instance, instance.first.id, 'host-secret-1')).json()).hostToken;
    const headers = { 'X-RSVP-Host-Token': token, 'X-Admin-Session': token };
    for (const body of [{ action: 'list' }, { action: 'list-invitations' }, { action: 'delete-event', id: instance.first.id, deleteReplies: true },
        { action: 'delete-reply', id: 'x' }, { ...event, id: instance.first.id }, { action: 'save-appearance' }]) {
        assert.equal((await instance.post(body, headers)).status, 401, body.action);
    }
    const host = { 'X-RSVP-Host-Token': token };
    const data = await (await instance.post({ action: 'host-list', eventId: instance.second.id }, host)).json();
    assert.ok(data.responses.every(item => item.eventId === instance.first.id));
    assert.equal((await login(instance, instance.second.id, 'host-secret-1')).status, 401);
});

test('host login fails uniformly, is rate limited, and rejects missing or invalid tokens', async () => {
    const instance = await setup();
    const messages = new Set();
    for (const [id, password] of [[instance.first.id, 'wrong-pass-1'], ['Zzzzzzz', 'host-secret-1'], ['bad id', 'x']]) {
        const result = await login(instance, id, password);
        assert.equal(result.status, 401);
        messages.add((await result.json()).error);
    }
    assert.equal(messages.size, 1);
    await login(instance, instance.first.id, 'wrong-pass-1');
    await login(instance, instance.first.id, 'wrong-pass-1');
    assert.equal((await login(instance, instance.first.id, 'host-secret-1')).status, 429);
    for (const headers of [{}, { 'X-RSVP-Host-Token': 'nope' }, { 'X-RSVP-Host-Token': 'a'.repeat(64) }]) {
        assert.equal((await instance.post({ action: 'host-list' }, headers)).status, 401);
    }
});

test('changing or removing the host password, or deleting the event, ends host sessions', async () => {
    for (const change of [{ hostPassword: 'brand-new-pass' }, { removeHostPassword: true, hostPassword: undefined }]) {
        const instance = await setup();
        const token = (await (await login(instance, instance.first.id, 'host-secret-1')).json()).hostToken;
        const headers = { 'X-RSVP-Host-Token': token };
        assert.equal((await instance.post({ action: 'host-list' }, headers)).status, 200);
        assert.equal((await instance.post({ ...event, id: instance.first.id, ...change }, admin)).status, 200);
        assert.equal((await instance.post({ action: 'host-list' }, headers)).status, 401);
    }
    const instance = await setup();
    const token = (await (await login(instance, instance.first.id, 'host-secret-1')).json()).hostToken;
    await instance.post({ action: 'delete-event', id: instance.first.id, deleteReplies: false }, admin);
    assert.equal((await instance.post({ action: 'host-list' }, { 'X-RSVP-Host-Token': token })).status, 401);
});

test('expired host sessions are rejected', async () => {
    const instance = await setup();
    const token = (await (await login(instance, instance.first.id, 'host-secret-1')).json()).hostToken;
    const key = 'rsvp-host-session:' + token;
    instance.records.set(key, JSON.stringify({ ...JSON.parse(instance.records.get(key)), expiresAt: Date.now() - 1 }));
    assert.equal((await instance.post({ action: 'host-list' }, { 'X-RSVP-Host-Token': token })).status, 401);
});

test('host login pages route to the host page for each category', () => {
    const source = readFileSync(`${__dirname}/../functions/rsvp/_middleware.js`, 'utf8');
    const pattern = new RegExp(/const HOST_LOGIN = (\/.*\/);/.exec(source)[1].slice(1, -1));
    for (const path of ['/rsvp/hostlogin', '/rsvp/wedding/hostlogin', '/rsvp/weddings/hostlogin/', '/rsvp/parties/hostlogin']) {
        assert.ok(pattern.test(path), path);
    }
    for (const path of ['/rsvp/admin', '/rsvp/weddings/', '/rsvp/wedding/hostlogin/x', '/rsvp/other/hostlogin']) {
        assert.ok(!pattern.test(path), path);
    }
});
