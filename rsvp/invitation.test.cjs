const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { webcrypto, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

const source = path => readFileSync(`${__dirname}/${path}`, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const idSource = source('invitation-id.js');
const ids = runInNewContext(idSource + '\n({ invitationId, generateInvitationId, invitationPath })', { crypto: webcrypto });
const contextSource = source('../functions/lib/auth.js') + '\n' + source('themes.js') + '\n' +
    idSource + '\n' + source('../functions/api/rsvp.js');
const adminToken = 'a'.repeat(64);
const invitation = { action: 'save-invitation', title: 'Private party', text: 'Date and venue',
    whatsapp: '+447700900123', sms: '' };
const reply = { action: 'submit', name: 'Alex', event: invitation.title, attending: 'yes', guests: 1, notes: '' };

function kv() {
    const records = new Map(), writes = [];
    return {
        records, writes,
        async get(key) { return records.get(key) || null; },
        async put(key, value, options) { writes.push({ key, value, options }); records.set(key, value); },
        async delete(key) { records.delete(key); },
        async list({ prefix, limit, cursor }) {
            const keys = [...records.keys()].filter(key => key.startsWith(prefix));
            const start = Number(cursor || 0), end = start + limit;
            return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, cursor: String(end) };
        }
    };
}

function api(crypto = webcrypto) {
    const env = { FORM_SUBMISSIONS: kv(), ADMIN_SESSIONS: kv(), RATE_LIMIT: kv() };
    env.ADMIN_SESSIONS.records.set(adminToken, JSON.stringify({ userId: '__admin__', expiresAt: Date.now() + 1800000 }));
    const context = { bcrypt, crypto, URL, Response, TextEncoder };
    runInNewContext(contextSource, context);
    return {
        env,
        validateAdminSession: token => context.validateSession(env, token),
        async post(body, { admin = false, guest, ip = '192.0.2.1' } = {}) {
            return context.onRequestPost({ env, request: new Request('https://example.com/api/rsvp', {
                method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json',
                    'CF-Connecting-IP': ip, ...(admin ? { 'X-Admin-Session': adminToken } : {}),
                    ...(guest ? { 'X-RSVP-Guest-Token': guest } : {}) }
            }) });
        }
    };
}

async function save(app, fields = {}) {
    const response = await app.post({ ...invitation, ...fields }, { admin: true });
    assert.equal(response.status, 200, await response.clone().text());
    const data = await response.json();
    assert.deepEqual(Object.keys(data.invitation).sort(),
        ['id', 'eventType', 'title', 'text', 'whatsapp', 'sms', 'passwordProtected'].sort());
    return data.invitation;
}

async function unlock(app, id, password = 'guest secret') {
    const response = await app.post({ action: 'unlock-invitation', id, password });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).guestToken;
}

test('random invitation codes use exactly seven URL-safe characters and reject legacy identifiers', () => {
    const codes = Array.from({ length: 10000 }, () => ids.generateInvitationId());
    assert.equal(new Set(codes).size, codes.length);
    codes.forEach(code => {
        assert.match(code, /^[A-Za-z0-9_-]{7}$/);
        assert.equal(ids.invitationId(code), code);
        assert.equal(ids.invitationPath(code), '/rsvp/i/' + code);
    });
    const deterministic = runInNewContext(idSource + '\ngenerateInvitationId()', {
        crypto: { getRandomValues: bytes => { bytes.set([0, 25, 26, 51, 52, 62, 255]); return bytes; } }
    });
    assert.equal(deterministic, 'AZaz0-_');
    for (const bad of [null, {}, '', 'A'.repeat(6), 'A'.repeat(8), 'A'.repeat(22), randomUUID(),
        codes[0] + '=', '../admin', 'rsvp:private', 'abc/def', 'abc%def', 'abc def', 'events', 'admin', 'view']) {
        assert.equal(ids.invitationId(bad), null, String(bad));
        assert.equal(ids.invitationPath(bad), '/rsvp/');
    }
});

test('creation retries storage collisions without overwriting invitations and stops after ten attempts', async () => {
    let attempts = 0;
    const app = api({ getRandomValues: bytes => { attempts++; bytes.fill(attempts <= 2 ? 0 : 1); return bytes; } });
    const original = JSON.stringify({ title: 'Existing', text: 'Do not overwrite' });
    app.env.FORM_SUBMISSIONS.records.set('rsvp-invitation:AAAAAAA', original);
    const event = await save(app);
    assert.equal(attempts, 3);
    assert.equal(event.id, 'BBBBBBB');
    assert.equal(await app.env.FORM_SUBMISSIONS.get('rsvp-invitation:AAAAAAA'), original);
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, 1);
    attempts = 0;
    const blocked = api({ getRandomValues: bytes => { attempts++; bytes.fill(0); return bytes; } });
    blocked.env.FORM_SUBMISSIONS.records.set('rsvp-invitation:AAAAAAA', original);
    const response = await blocked.post(invitation, { admin: true });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /unique invitation code.*try again/i);
    assert.equal(attempts, 10);
    assert.equal(blocked.env.FORM_SUBMISSIONS.writes.length, 0);
    assert.equal(await blocked.env.FORM_SUBMISSIONS.get('rsvp-invitation:AAAAAAA'), original);
});

test('creation fails closed if collision checks or invitation writes fail', async () => {
    for (const operation of ['get', 'put']) {
        const app = api();
        app.env.FORM_SUBMISSIONS[operation] = async () => { throw Error('private storage detail'); };
        const response = await app.post(invitation, { admin: true });
        assert.equal(response.status, 500);
        assert.doesNotMatch(await response.text(), /private storage detail/);
        assert.equal(app.env.FORM_SUBMISSIONS.writes.length, 0);
    }
});

test('legacy invitation IDs are rejected in all API actions and skipped in paginated invitation lists', async () => {
    const app = api();
    const legacy = [randomUUID(), 'gQvuFEFxRDKh4N9Xdm-u8g'];
    for (let i = 0; i < 51; i++) {
        const id = i === 0 ? legacy[1] : randomUUID();
        app.env.FORM_SUBMISSIONS.records.set('rsvp-invitation:' + id, JSON.stringify({ ...invitation, id }));
    }
    app.env.FORM_SUBMISSIONS.records.set('rsvp-invitation:' + legacy[0], JSON.stringify(invitation));
    const event = await save(app);
    const writes = app.env.FORM_SUBMISSIONS.writes.length;
    for (const id of legacy) {
        for (const body of [
            { action: 'get-invitation', id },
            { action: 'unlock-invitation', id, password: 'guest secret' },
            { ...invitation, id },
            { ...reply, eventId: id },
            { action: 'delete-event', id, deleteReplies: false },
            { action: 'list', eventId: id }
        ]) {
            assert.equal((await app.post(body, { admin: true })).status, 400, JSON.stringify(body));
        }
    }
    const first = await (await app.post({ action: 'list-invitations' }, { admin: true })).json();
    assert.deepEqual(first.invitations, []);
    assert.ok(first.cursor);
    const second = await (await app.post({ action: 'list-invitations', cursor: first.cursor }, { admin: true })).json();
    assert.deepEqual(second.invitations, [event]);
    assert.equal(second.cursor, '');
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, writes);
});

test('short-code records paginate without writes; category edits keep the same code', async () => {
    const app = api();
    const categories = ['celebration', 'events', 'weddings', 'parties', 'engagements'];
    const originals = [];
    for (let i = 0; i < 107; i++) {
        const id = ids.generateInvitationId();
        const record = { id, title: invitation.title, text: invitation.text, eventType: categories[i % 5],
            futureMetadata: { untouched: true }, privateSecret: 'never expose', passwordHash: 'unrelated secret' };
        const raw = JSON.stringify(record);
        app.env.FORM_SUBMISSIONS.records.set('rsvp-invitation:' + id, raw);
        originals.push([id, raw]);
    }
    const pages = [];
    let cursor = '';
    do {
        const result = await app.post({ action: 'list-invitations', cursor }, { admin: true });
        const data = await result.json();
        pages.push(...data.invitations);
        cursor = data.cursor;
    } while (cursor);
    assert.equal(pages.length, originals.length);
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, 0);
    for (const [index, [id, raw]] of originals.entries()) {
        assert.equal(pages[index].id, id);
        const response = await app.post({ action: 'get-invitation', id });
        const payload = await response.json();
        assert.equal(payload.invitation.id, id);
        assert.doesNotMatch(JSON.stringify(payload), /futureMetadata|privateSecret|passwordHash|never expose/);
        assert.equal(app.env.FORM_SUBMISSIONS.records.get('rsvp-invitation:' + id), raw);
    }
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, 0);
    for (const event of pages.slice(0, 5)) {
        for (let edit = 0; edit < 3; edit++) {
            const changed = await save(app, { id: event.id, eventType: event.eventType, text: 'Edit ' + edit });
            assert.equal(changed.id, event.id);
            assert.equal(JSON.parse(await app.env.FORM_SUBMISSIONS.get('rsvp-invitation:' + event.id)).futureMetadata.untouched, true);
            const submitted = await app.post({ ...reply, eventId: changed.id });
            assert.equal(submitted.status, 200);
            assert.equal((await submitted.json()).response.eventId, event.id);
        }
    }
});

test('protection gates short-code reads/submissions across every category; DTOs never disclose hashes', async () => {
    for (const eventType of ['celebration', 'events', 'weddings', 'parties', 'engagements']) {
        const app = api();
        const original = await save(app, { eventType });
        const event = await save(app, { id: original.id, eventType, guestPassword: 'guest secret' });
        assert.equal(event.id, original.id);
        assert.equal(event.passwordProtected, true);
        const stored = JSON.parse(await app.env.FORM_SUBMISSIONS.get('rsvp-invitation:' + event.id));
        assert.match(stored.guestPasswordHash, /^\$2[aby]\$12\$/);
        assert.equal(await bcrypt.compare('guest secret', stored.guestPasswordHash), true);
        assert.doesNotMatch(JSON.stringify(stored), /"guestPassword":/);
        for (const admin of [false, true]) {
            const read = await app.post({ action: 'get-invitation', id: event.id }, { admin });
            assert.equal(read.status, admin ? 200 : 401);
            const payload = await read.text();
            assert.doesNotMatch(payload, /guestPasswordHash|\$2[aby]\$/);
            if (!admin) assert.doesNotMatch(payload, /Date and venue/);
            assert.equal((await app.post({ ...reply, eventId: event.id }, { admin })).status, 401);
        }
        const token = await unlock(app, event.id);
        assert.match(token, /^[a-f0-9]{64}$/);
        const sessionWrite = app.env.FORM_SUBMISSIONS.writes.at(-1);
        assert.ok(sessionWrite.key.startsWith('rsvp-guest-session:'));
        assert.equal(app.env.ADMIN_SESSIONS.writes.length, 0);
        assert.equal(sessionWrite.options.expirationTtl, 1800);
        const session = JSON.parse(sessionWrite.value);
        assert.equal(session.invitationId, event.id);
        assert.equal(session.scope, 'rsvp-guest');
        assert.equal(session.userId, undefined);
        const read = await app.post({ action: 'get-invitation', id: event.id }, { guest: token });
        assert.equal(read.status, 200);
        assert.doesNotMatch(await read.text(), /guest secret|guestPasswordHash|guestPasswordRevision|\$2[aby]\$/);
        const submitted = await app.post({ ...reply, eventId: event.id }, { guest: token });
        assert.equal(submitted.status, 200);
        assert.equal((await submitted.json()).response.eventId, event.id);
        const listed = await app.post({ action: 'list-invitations' }, { admin: true });
        assert.doesNotMatch(await listed.text(), /guestPasswordHash|guestPasswordRevision|guest secret|\$2[aby]\$/);
        const unchanged = await save(app, { id: event.id, eventType, guestPassword: '' });
        assert.equal(unchanged.passwordProtected, true);
        assert.equal(JSON.parse(await app.env.FORM_SUBMISSIONS.get('rsvp-invitation:' + event.id)).guestPasswordHash, stored.guestPasswordHash);
        assert.equal((await app.post({ ...reply, eventId: event.id }, { guest: token })).status, 200);
    }
});

test('parallel invitation creation requires exactly one record per invitation with no alias writes or collisions', async () => {
    const app = api();
    const events = await Promise.all(Array.from({ length: 60 }, () => save(app)));
    assert.equal(new Set(events.map(event => event.id)).size, 60);
    assert.ok(events.every(event => /^[A-Za-z0-9_-]{7}$/.test(event.id)));
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, 60);
    assert.equal(app.env.FORM_SUBMISSIONS.records.size, 60);
    assert.ok(app.env.FORM_SUBMISSIONS.writes.every(write => write.key.startsWith('rsvp-invitation:')));
    await Promise.all(events.map(async event => {
        const read = await app.post({ action: 'get-invitation', id: event.id });
        assert.equal((await read.json()).invitation.id, event.id);
    }));
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, 60);
});

test('a protection change during submission rolls back the late reply', async () => {
    const app = api();
    const event = await save(app, { guestPassword: 'guest secret' });
    const token = await unlock(app, event.id);
    const put = app.env.FORM_SUBMISSIONS.put.bind(app.env.FORM_SUBMISSIONS);
    app.env.FORM_SUBMISSIONS.put = async (key, value, options) => {
        await put(key, value, options);
        if (key.startsWith('rsvp:')) {
            const record = JSON.parse(await app.env.FORM_SUBMISSIONS.get('rsvp-invitation:' + event.id));
            record.guestPasswordRevision = randomUUID();
            await put('rsvp-invitation:' + event.id, JSON.stringify(record));
        }
    };
    assert.equal((await app.post({ ...reply, eventId: event.id }, { guest: token })).status, 401);
    assert.equal([...app.env.FORM_SUBMISSIONS.records.keys()].some(key => key.startsWith('rsvp:')), false);
});

test('submission revalidates guest sessions after writing and rolls back expiry, revocation or unavailable session storage', async () => {
    for (const change of ['expired', 'deleted', 'unavailable']) {
        const app = api();
        const event = await save(app, { guestPassword: 'guest secret' });
        const token = await unlock(app, event.id);
        const put = app.env.FORM_SUBMISSIONS.put.bind(app.env.FORM_SUBMISSIONS);
        app.env.FORM_SUBMISSIONS.put = async (key, value, options) => {
            await put(key, value, options);
            if (!key.startsWith('rsvp:')) return;
            const sessionKey = 'rsvp-guest-session:' + token;
            if (change === 'expired') {
                const session = JSON.parse(await app.env.FORM_SUBMISSIONS.get(sessionKey));
                app.env.FORM_SUBMISSIONS.records.set(sessionKey, JSON.stringify({ ...session, expiresAt: Date.now() - 1 }));
            } else if (change === 'deleted') {
                app.env.FORM_SUBMISSIONS.records.delete(sessionKey);
            } else {
                const get = app.env.FORM_SUBMISSIONS.get.bind(app.env.FORM_SUBMISSIONS);
                app.env.FORM_SUBMISSIONS.get = async key => {
                    if (key.startsWith('rsvp-guest-session:')) throw new Error('private storage error');
                    return get(key);
                };
            }
        };
        const response = await app.post({ ...reply, eventId: event.id }, { guest: token });
        assert.equal(response.status, change === 'unavailable' ? 500 : 401);
        assert.doesNotMatch(await response.text(), /private storage error/);
        assert.equal([...app.env.FORM_SUBMISSIONS.records.keys()].some(key => key.startsWith('rsvp:')), false);
    }
});

test('guest passwords retain exact spaces and support the UTF-8 byte limit while blank or omitted keeps protection unchanged', async () => {
    const app = api();
    const password = '  guest secret  ';
    const event = await save(app, { guestPassword: password });
    const stored = JSON.parse(await app.env.FORM_SUBMISSIONS.get('rsvp-invitation:' + event.id));
    const token = await unlock(app, event.id, password);
    for (const fields of [{}, { guestPassword: '' }]) {
        await save(app, { id: event.id, ...fields });
        assert.equal(JSON.parse(await app.env.FORM_SUBMISSIONS.get('rsvp-invitation:' + event.id)).guestPasswordHash, stored.guestPasswordHash);
        assert.equal((await app.post({ ...reply, eventId: event.id }, { guest: token })).status, 200);
    }
    const unicode = await save(app, { id: event.id, guestPassword: '😀'.repeat(18) });
    assert.equal(unicode.passwordProtected, true);
    assert.ok(await unlock(app, event.id, '😀'.repeat(18)));
    await save(app, { id: event.id, guestPassword: '', removeGuestPassword: true });
    assert.equal((await app.post({ ...reply, eventId: event.id }, { guest: token })).status, 200);
});

test('guest sessions are scoped, expire and revoke on password changes/removal/deletion without granting admin access', async () => {
    const app = api();
    const first = await save(app, { guestPassword: 'guest secret' });
    const second = await save(app, { guestPassword: 'guest secret' });
    const token = await unlock(app, first.id);
    assert.equal((await app.post({ action: 'list-invitations' }, { guest: token })).status, 401);
    assert.equal((await app.post({ action: 'get-invitation', id: second.id }, { guest: token })).status, 401);
    assert.equal((await app.post({ ...reply, eventId: second.id }, { guest: token })).status, 401);
    const sessionKey = 'rsvp-guest-session:' + token;
    const original = JSON.parse(await app.env.FORM_SUBMISSIONS.get(sessionKey));
    app.env.FORM_SUBMISSIONS.records.set(sessionKey, JSON.stringify({ ...original, expiresAt: Date.now() - 1 }));
    assert.equal((await app.post({ ...reply, eventId: first.id }, { guest: token })).status, 401);
    app.env.FORM_SUBMISSIONS.records.set(sessionKey, JSON.stringify(original));
    await save(app, { id: first.id, guestPassword: 'changed secret' });
    assert.equal((await app.post({ action: 'get-invitation', id: first.id }, { guest: token })).status, 401);
    assert.equal((await app.post({ ...reply, eventId: first.id }, { guest: token })).status, 401);
    const changed = await unlock(app, first.id, 'changed secret');
    await save(app, { id: first.id, removeGuestPassword: true });
    assert.equal((await app.post({ ...reply, eventId: first.id }, { guest: changed })).status, 200);
    assert.equal((await app.post({ action: 'get-invitation', id: first.id }, { guest: 'malformed-stale-token' })).status, 200);
    assert.equal((await app.post({ ...reply, eventId: first.id })).status, 200);
    await save(app, { id: first.id, guestPassword: 'changed secret' });
    assert.equal((await app.post({ ...reply, eventId: first.id }, { guest: changed })).status, 401);
    const current = await unlock(app, first.id, 'changed secret');
    await app.post({ action: 'delete-event', id: first.id, deleteReplies: false }, { admin: true });
    for (const id of [first.id, ids.generateInvitationId()]) {
        assert.equal((await app.post({ action: 'get-invitation', id }, { guest: current })).status, 404);
        assert.equal((await app.post({ ...reply, eventId: id }, { guest: current })).status, 404);
        assert.equal((await app.post({ action: 'unlock-invitation', id, password: 'changed secret' })).status, 404);
    }
    assert.equal((await app.post(reply)).status, 200);
});

test('guest sessions cannot authenticate to real admin APIs with raw or prefixed tokens and never enter invitation or reply lists', async () => {
    const app = api();
    app.env.MEMORIAL_PASSWORDS = kv();
    app.env.MEMORIAL_PASSWORDS.records.set('__admin__', 'unchanged-admin-password-hash');
    const event = await save(app, { guestPassword: 'guest secret' });
    const token = await unlock(app, event.id);
    const guestKey = 'rsvp-guest-session:' + token;
    assert.ok(await app.env.FORM_SUBMISSIONS.get(guestKey));
    assert.equal(app.env.ADMIN_SESSIONS.records.size, 1);
    assert.equal((await app.validateAdminSession(adminToken)).userId, '__admin__');
    const passwordContext = { bcrypt, crypto: webcrypto, Response };
    runInNewContext(source('../functions/lib/auth.js') + '\n' + source('../functions/api/password.js'), passwordContext);
    for (const candidate of [token, guestKey, 'rsvp-guest:' + token]) {
        assert.equal(await app.validateAdminSession(candidate), null);
        assert.equal(await app.env.ADMIN_SESSIONS.get(candidate), null);
        for (const action of ['set', 'delete']) {
            const response = await passwordContext.onRequestPost({
                env: app.env,
                request: new Request('https://example.com/api/password', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Session': candidate },
                    body: JSON.stringify({ action, id: '__admin__', password: 'attacker-chosen-password' })
                })
            });
            assert.equal(response.status, 401, action + ': ' + candidate);
        }
    }
    assert.equal(await app.env.MEMORIAL_PASSWORDS.get('__admin__'), 'unchanged-admin-password-hash');
    assert.equal(app.env.MEMORIAL_PASSWORDS.writes.length, 0);
    assert.equal((await app.post(reply)).status, 200);
    const writes = app.env.FORM_SUBMISSIONS.writes.length;
    for (const action of ['list-invitations', 'list']) {
        const response = await app.post({ action }, { admin: true });
        const payload = await response.json();
        const records = payload.invitations || payload.responses;
        assert.equal(records.length, 1);
        assert.doesNotMatch(JSON.stringify(payload), /rsvp-guest-session:|"scope"|"protection"|"revision"|guestPasswordHash/);
        assert.ok(records.every(record => record.id !== guestKey && record.id !== token));
    }
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, writes);
});

test('guest unlock, invitation read and submit do not depend on the admin session binding', async () => {
    const app = api();
    const event = await save(app, { guestPassword: 'guest secret' });
    delete app.env.ADMIN_SESSIONS;
    const token = await unlock(app, event.id);
    assert.equal((await app.post({ action: 'get-invitation', id: event.id }, { guest: token })).status, 200);
    assert.equal((await app.post({ ...reply, eventId: event.id }, { guest: token })).status, 200);
});

test('guest password attempts use the existing rate limiter but a separate namespace and fail closed without bindings', async () => {
    const app = api();
    const event = await save(app, { guestPassword: 'guest secret' });
    app.env.RATE_LIMIT.records.set('rate_limit:192.0.2.1', JSON.stringify({
        attempts: 10, windowStart: Date.now(), lockedUntil: Date.now() + 900000
    }));
    const token = await unlock(app, event.id);
    assert.ok(token);
    for (let i = 0; i < 3; i++) {
        const failed = await app.post({ action: 'unlock-invitation', id: event.id, password: 'wrong' });
        assert.equal(failed.status, i === 2 ? 429 : 401);
        if (i === 2) assert.ok(Number(failed.headers.get('Retry-After')) > 0);
    }
    const limited = await app.post({ action: 'unlock-invitation', id: event.id, password: 'guest secret' });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Cache-Control'), 'no-store');
    assert.ok(Number(limited.headers.get('Retry-After')) > 0);
    assert.ok(Number(limited.headers.get('Retry-After')) <= 900);
    assert.ok(await app.env.RATE_LIMIT.get('rate_limit:rsvp-guest:192.0.2.1'));
    for (const binding of ['RATE_LIMIT', 'FORM_SUBMISSIONS']) {
        const previous = app.env[binding];
        delete app.env[binding];
        assert.equal((await app.post({ action: 'unlock-invitation', id: event.id, password: 'guest secret' })).status, 503);
        assert.equal((await app.post({ ...reply, eventId: event.id })).status, binding === 'FORM_SUBMISSIONS' ? 503 : 401);
        if (binding === 'RATE_LIMIT') {
            assert.equal((await app.post({ ...invitation, guestPassword: 'new secret' }, { admin: true })).status, 503);
        }
        app.env[binding] = previous;
    }
    const writes = app.env.FORM_SUBMISSIONS.writes.length;
    for (const fields of [{ guestPassword: 42 }, { guestPassword: 'short' }, { guestPassword: '        ' },
        { guestPassword: '😀'.repeat(7) }, { removeGuestPassword: 'true' },
        { guestPassword: 'x', removeGuestPassword: true }, { guestPassword: '😀'.repeat(19) }]) {
        assert.equal((await app.post({ ...invitation, id: event.id, ...fields }, { admin: true })).status, 400);
    }
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, writes);
});

test('invitation-only namespace never resolves short codes to other KV records', async () => {
    const app = api();
    const id = ids.generateInvitationId();
    app.env.FORM_SUBMISSIONS.records.set('rsvp:' + id, '{"name":"private reply"}');
    app.env.FORM_SUBMISSIONS.records.set(id, '{"secret":"private value"}');
    assert.equal((await app.post({ action: 'get-invitation', id })).status, 404);
    assert.equal((await app.post({ ...reply, eventId: id })).status, 404);
    assert.equal(app.env.FORM_SUBMISSIONS.writes.length, 0);
});

test('short-route middleware keeps existing routes, validates canonically and safely follows same-origin asset redirects', async () => {
    const context = { URL, Request, Response };
    runInNewContext(idSource + '\n' + source('../functions/rsvp/_middleware.js'), context);
    const code = ids.generateInvitationId(), calls = [];
    const request = (path, fetch, method = 'GET') => context.onRequest({
        request: new Request('https://example.com' + path, { method }),
        env: { ASSETS: { fetch } }, next: () => new Response('existing route', { status: 201 })
    });
    const fetch = async req => {
        calls.push([req.url, req.method, req.redirect]);
        return req.url.endsWith('/rsvp/') ? new Response(null, { status: 302, headers: { Location: '/rsvp/index.html' } }) :
            new Response('<html>existing invitation landing</html>');
    };
    assert.equal(await (await request('/rsvp/i/' + code, fetch)).text(), '<html>existing invitation landing</html>');
    assert.deepEqual(calls.map(call => call[0]), ['https://example.com/rsvp/', 'https://example.com/rsvp/index.html']);
    assert.ok(calls.every(call => call[2] === 'manual'));
    assert.equal((await request('/rsvp/i/' + code + '/', fetch, 'HEAD')).status, 200);
    for (const path of ['/rsvp/', '/rsvp/admin', '/rsvp/view', '/rsvp/events/', '/rsvp/weddings/',
        '/rsvp/parties/', '/rsvp/engagements/', '/rsvp/card.css', '/rsvp/rsvp.js']) {
        assert.equal((await request(path, fetch)).status, 201);
    }
    for (const invalid of ['A'.repeat(22), randomUUID(), 'A'.repeat(6), 'A'.repeat(8), 'abc%def']) {
        assert.equal((await request('/rsvp/i/' + invalid, fetch)).status, 404);
    }
    assert.equal((await request('/rsvp/i/' + code, fetch, 'POST')).status, 405);
    const credentialed = new URL('https://example.com/rsvp/');
    credentialed.username = 'fixture';
    for (const location of ['https://evil.example/rsvp/', '/api/rsvp', 'http://example.com/rsvp/', '/rsvp/i/' + code,
        credentialed.href]) {
        let fetched = 0;
        const response = await request('/rsvp/i/' + code, async () => {
            fetched++;
            return new Response(null, { status: 302, headers: { Location: location } });
        });
        assert.equal(response.status, 503);
        assert.equal(fetched, 1);
    }
    let loops = 0;
    assert.equal((await request('/rsvp/i/' + code, async () => {
        loops++;
        return new Response(null, { status: 301, headers: { Location: '/rsvp/' } });
    })).status, 503);
    assert.equal(loops, 4);
});
