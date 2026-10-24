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
        validateSession: async (_, token) => token === 'valid-session' ? { userId: '__admin__' } :
            token === 'other-user' ? { userId: 'other' } : null
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
        replaceChildren() { this.children = []; },
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

test('all three pages use shared RSVP assets without unrelated contact features', () => {
    for (const page of ['index', 'admin', 'view']) {
        const html = readFileSync(`${__dirname}/${page}.html`, 'utf8');
        assert.match(html, /href="\/rsvp\/card\.css"/);
        assert.match(html, /src="\/rsvp\/card-render\.js"/);
        assert.match(html, /src="\/rsvp\/rsvp\.js"/);
        assert.doesNotMatch(html, /vcard|facebook|instagram|linkedin/i);
    }
});

const invitation = {
    action: 'save-invitation', title: ' A lovely celebration ', text: ' Welcome\n\nBring joy <script>alert(1)</script> ',
    whatsapp: '+447700900123', email: 'host+party@example.com'
};

async function createEvent(instance, fields = {}) {
    const result = await instance.post({ ...invitation, ...fields }, 'valid-session');
    assert.equal(result.status, 200);
    return (await result.json()).invitation;
}

test('invitations require site-admin auth for edits and persist public content separately from responses', async () => {
    const instance = api();
    for (const token of [undefined, 'invalid-session', 'other-user']) {
        assert.equal((await instance.post(invitation, token)).status, 401);
        assert.equal((await instance.post({ action: 'list' }, token)).status, 401);
    }
    const first = await createEvent(instance);
    const second = await createEvent(instance, { title: 'Second event', email: 'other@example.com' });
    assert.notEqual(first.id, second.id);
    assert.equal(first.text, 'Welcome\n\nBring joy <script>alert(1)</script>');
    await instance.post({ ...valid, eventId: first.id, event: first.title });
    const loaded = await instance.post({ action: 'get-invitation', id: first.id });
    assert.equal(loaded.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual((await loaded.json()).invitation, first);
    const listed = await (await instance.post({ action: 'list' }, 'valid-session')).json();
    assert.equal(listed.responses.length, 1);
    assert.equal(listed.responses[0].eventId, first.id);
    assert.equal(listed.responses[0].text, undefined);
    const edited = await createEvent(instance, { id: first.id, text: 'Updated\ninvitation' });
    assert.equal(edited.id, first.id);
    const other = await (await instance.post({ action: 'get-invitation', id: second.id })).json();
    assert.deepEqual(other.invitation, second);
    assert.equal((await instance.post({ action: 'get-invitation', id: 'rsvp:private' })).status, 400);
    const missing = '00000000-0000-4000-8000-000000000000';
    assert.equal((await instance.post({ action: 'get-invitation', id: missing })).status, 404);
    assert.equal((await instance.post({ ...invitation, id: missing }, 'valid-session')).status, 404);
});

test('validates invitation fields and destinations, allowing either, both or neither channel', async () => {
    const instance = api();
    for (const fields of [
        { title: '' }, { title: 'x'.repeat(101) }, { text: '' }, { text: 'x'.repeat(5001) },
        { text: null }, { id: '../private' }, { whatsapp: '07700900123' },
        { whatsapp: '+0123456789' }, { whatsapp: '+447700900123?text=bad' },
        { whatsapp: '+123' }, { whatsapp: '+1234567890123456' },
        { email: 'host@example.com\r\nBcc:other@example.com' },
        { email: 'host@example.com?subject=bad' }, { email: 'not-an-email' },
        { email: 'host@-example.com' }, { email: 'x'.repeat(255) }
    ]) {
        assert.equal((await instance.post({ ...invitation, ...fields }, 'valid-session')).status, 400, JSON.stringify(fields));
    }
    assert.equal(instance.records.size, 0);
    for (const fields of [{ whatsapp: '' }, { email: '' }, { whatsapp: '', email: '' }]) {
        await createEvent(instance, fields);
    }
});

test('event-bound submissions reject mismatches and return only that event’s routing with a canonical receipt', async () => {
    const instance = api();
    const first = await createEvent(instance);
    const second = await createEvent(instance, { title: 'Another event', whatsapp: '', email: 'second@example.com' });
    for (const fields of [
        { eventId: first.id, event: second.title },
        { eventId: second.id, event: first.title },
        { eventId: 'bad' },
        { eventId: '00000000-0000-4000-8000-000000000000' }
    ]) {
        assert.notEqual((await instance.post({ ...valid, ...fields })).status, 200);
    }
    for (const event of [first, second]) {
        const data = await (await instance.post({
            ...valid, eventId: event.id, event: event.title, organiser: { email: 'attacker@example.com' }
        })).json();
        assert.equal(data.response.eventId, event.id);
        assert.equal(data.response.name, 'Alex');
        assert.deepEqual(data.organiser, { whatsapp: event.whatsapp, email: event.email });
    }
    const legacy = await (await instance.post(valid)).json();
    assert.deepEqual(legacy.organiser, {});
});

function renderer() {
    const context = { window: {}, document: { createElement: element } };
    runInNewContext(readFileSync(`${__dirname}/card-render.js`, 'utf8'), context);
    return context.window.RSVP;
}

test('channel links validate destinations and encode the event and all five fields exactly', () => {
    const rsvp = renderer();
    const response = { name: 'Zoë & Alex', event: 'Tea & cake #1?', attending: 'yes', guests: 2, notes: 'A&B\n+ <hello> ?#' };
    const links = rsvp.channels(response, invitation);
    assert.equal(links.length, 2);
    const whatsapp = new URL(links[0].href);
    assert.equal(whatsapp.origin + whatsapp.pathname, 'https://wa.me/447700900123');
    const message = 'RSVP\nName: Zoë & Alex\nEvent: Tea & cake #1?\nAttending: Yes\nGuests (additional): 2\nNotes: A&B\n+ <hello> ?#';
    assert.equal(whatsapp.searchParams.get('text'), message);
    const mail = new URL(links[1].href);
    assert.equal(decodeURIComponent(mail.pathname), invitation.email);
    assert.equal(mail.searchParams.get('subject'), 'RSVP: ' + response.event);
    assert.equal(mail.searchParams.get('body'), message);
    assert.equal(rsvp.channels(response, {}).length, 0);
    assert.equal(rsvp.channels(response, { whatsapp: '+123', email: 'a@b.com\nBcc:x@y.com' }).length, 0);
    assert.equal(rsvp.channels(response, { email: 'a@b.com?bad' }).length, 0);
    assert.equal(rsvp.channels(response, { whatsapp: invitation.whatsapp }).length, 1);
    assert.equal(rsvp.channels(response, { email: invitation.email }).length, 1);
    const root = element('section');
    rsvp.sendOptions(root, { ...response, attending: 'no', guests: 0, notes: '' }, {});
    assert.equal(root.hidden, false);
    assert.match(root.children[0].textContent, /no external message has been sent/);
    rsvp.sendOptions(root, response, invitation);
    assert.equal(root.children.length, 3);
    assert.match(root.children[0].textContent, /Nothing has been sent/);
    assert.equal(root.children[1].rel, 'noopener noreferrer');
});

function browser({ page = 'index', storageFails = false, saved, failSave = false, expired = false } = {}) {
    const nodes = {};
    function node(id) {
        if (!nodes[id]) nodes[id] = {
            ...element('div'), hidden: true, value: '', disabled: false, handlers: {},
            classList: { toggle() {} },
            addEventListener(name, callback) { this.handlers[name] = callback; },
            focus() { this.focused = true; },
            reset() {
                if (this.elements) Object.values(this.elements).forEach(field => { field.value = ''; });
            },
            querySelector() { return node(id + 'Button'); }
        };
        return nodes[id];
    }
    const form = node('rsvpForm');
    form.elements = Object.fromEntries(['name', 'event', 'attending', 'guests', 'notes'].map(id => [id, node(id)]));
    if (page === 'admin') {
        node('password').value = 'test-only-password';
        node('invitationForm').elements = Object.fromEntries(
            ['id', 'title', 'text', 'whatsapp', 'email'].map(id => [id, node('editor-' + id)])
        );
    }
    const event = { id: '12345678-1234-4123-8123-123456789012', title: 'Saved party', text: '<img src=x>\nSecond line', whatsapp: invitation.whatsapp, email: invitation.email };
    const requests = [];
    const stored = new Map(saved ? [['rsvp_receipt', JSON.stringify(saved)]] : []);
    const redirects = [];
    const context = {
        URLSearchParams, document: {
            createElement: element,
            createTextNode(text) { return { textContent: text }; },
            getElementById(id) {
                if ((id === 'loginForm' && page !== 'admin') || (id === 'rsvpForm' && page !== 'index') || (id === 'receipt' && page !== 'view')) return null;
                return node(id);
            },
            querySelector() { return node('back'); }
        },
        sessionStorage: {
            setItem(key, value) { if (storageFails) throw Error('disabled'); stored.set(key, value); },
            getItem(key) { return stored.get(key); }
        },
        window: { location: { origin: 'https://example.com', search: '?id=' + event.id, assign(path) { redirects.push(path); } } },
        fetch: async (path, options) => {
            const payload = JSON.parse(options.body);
            requests.push(payload);
            if (payload.action === 'get-invitation') return { ok: true, json: async () => ({ success: true, invitation: event }) };
            if (payload.action === 'verify') return { ok: true, json: async () => ({ success: true, sessionToken: 'valid-session' }) };
            if (payload.action === 'list') return { ok: true, json: async () => ({ success: true, responses: [], cursor: '' }) };
            if (payload.action === 'save-invitation') {
                assert.equal(options.headers['X-Admin-Session'], 'valid-session');
                return expired ?
                    { ok: false, status: 401, json: async () => ({ success: false, error: 'Unauthorized' }) } :
                    { ok: true, json: async () => ({ success: true, invitation: { ...event, ...payload } }) };
            }
            if (failSave) return { ok: false, status: 500, json: async () => ({ success: false, error: 'Storage unavailable' }) };
            const { action, ...response } = payload;
            return { ok: true, json: async () => ({ success: true, response, organiser: invitation }) };
        }
    };
    runInNewContext(readFileSync(`${__dirname}/card-render.js`, 'utf8'), context);
    runInNewContext(readFileSync(`${__dirname}/rsvp.js`, 'utf8'), context);
    return { nodes, requests, stored, redirects, event, tick: () => new Promise(resolve => setImmediate(resolve)) };
}

test('guest loads safe multiline invitation, reveals prefilled form, saves event ID and preserves send options through receipt redirect', async () => {
    const app = browser();
    await app.tick();
    assert.equal(app.nodes.heading.textContent, app.event.title);
    assert.equal(app.nodes.invitationText.textContent, app.event.text);
    assert.equal(app.nodes.event.value, app.event.title);
    app.nodes.openRsvp.handlers.click();
    assert.equal(app.nodes.rsvpForm.hidden, false);
    assert.equal(app.nodes.name.focused, true);
    Object.assign(app.nodes.name, { value: 'Guest' });
    app.nodes.attending.value = 'no';
    app.nodes.guests.value = '2';
    app.nodes.attending.handlers.change();
    assert.equal(app.nodes.guests.value, '0');
    assert.equal(app.nodes.guests.disabled, true);
    await app.nodes.rsvpForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.requests[1].eventId, app.event.id);
    assert.deepEqual(app.redirects, ['/rsvp/view']);
    const receipt = JSON.parse(app.stored.get('rsvp_receipt'));
    const view = browser({ page: 'view', saved: receipt });
    assert.equal(view.nodes.receipt.children.length, 1);
    assert.equal(view.nodes.sendOptions.children.length, 3);
    assert.equal(view.nodes.back.href, '/rsvp/?id=' + app.event.id);
    assert.doesNotMatch(view.nodes.back.href, /Guest|notes|attending/);
});

test('storage-disabled browser retains reply and channel choices; failed server save does not offer a saved receipt', async () => {
    for (const failSave of [false, true]) {
        const app = browser({ storageFails: true, failSave });
        await app.tick();
        app.nodes.name.value = 'Keep my reply';
        app.nodes.attending.value = 'yes';
        app.nodes.guests.value = '0';
        app.nodes.notes.value = 'Keep these notes';
        await app.nodes.rsvpForm.handlers.submit({ preventDefault() {} });
        assert.equal(app.nodes.name.value, 'Keep my reply');
        assert.equal(app.nodes.notes.value, 'Keep these notes');
        assert.equal(app.redirects.length, 0);
        if (failSave) {
            assert.equal(app.nodes.message.textContent, 'Storage unavailable');
            assert.equal(app.nodes.sendOptions.hidden, true);
        } else {
            assert.equal(app.nodes.sendOptions.children.length, 3);
        }
    }
});

test('organiser login, create, reload, edit, new invitation and logout preserve protected workflow', async () => {
    const app = browser({ page: 'admin' });
    await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.requests[0].id, '__admin__');
    assert.equal(app.nodes.invitationForm.hidden, false);
    for (const [field, value] of Object.entries(invitation)) {
        if (field !== 'action') app.nodes['editor-' + field].value = value;
    }
    await app.nodes.invitationForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.requests[2].action, 'save-invitation');
    assert.equal(app.requests[2].id, undefined);
    assert.equal(app.nodes['editor-id'].value, app.event.id);
    const link = app.nodes.shareInvitation.children[1];
    assert.equal(link.href, 'https://example.com/rsvp/?id=' + app.event.id);
    assert.doesNotMatch(link.href, /password|whatsapp|email|text=/i);
    await app.nodes.loadInvitation.handlers.click();
    assert.equal(app.nodes['editor-text'].value, app.event.text);
    app.nodes['editor-text'].value = 'Changed\ninvitation';
    await app.nodes.invitationForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.requests.at(-1).id, app.event.id);
    app.nodes.newInvitation.handlers.click();
    assert.equal(app.nodes['editor-id'].value, '');
    assert.equal(app.nodes.shareInvitation.children.length, 0);
    app.nodes.logout.handlers.click();
    assert.equal(app.nodes.loginForm.hidden, false);
    assert.equal(app.nodes.invitationForm.hidden, true);
    assert.equal(app.nodes.responses.children.length, 0);
});

test('expired organiser session hides and clears invitation editor', async () => {
    const app = browser({ page: 'admin', expired: true });
    await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
    await app.nodes.invitationForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.nodes.invitationForm.hidden, true);
    assert.equal(app.nodes.loginForm.hidden, false);
    assert.equal(app.nodes.shareInvitation.children.length, 0);
    assert.equal(app.nodes.message.textContent, 'Unauthorized');
});
