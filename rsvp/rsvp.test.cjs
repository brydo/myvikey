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
                const keys = [...records.keys()].filter(key => key.startsWith(options.prefix));
                const offset = Number(options.cursor) || 0;
                const end = offset + options.limit;
                return {
                    keys: keys.slice(offset, end).map(name => ({ name })),
                    list_complete: end >= keys.length, cursor: end >= keys.length ? '' : String(end)
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

test('stores the five RSVP fields and server timestamp, trims text, and gives each response its own key', async () => {
    const { post, records } = api();
    for (let i = 0; i < 2; i++) {
        const result = await post({ ...valid, phone: 'ignored', email: 'ignored', id: 'ignored' });
        assert.equal(result.status, 200);
        assert.equal(result.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(records.size, 2);
    for (const [key, raw] of records) {
        assert.match(key, /^rsvp:[0-9a-f-]{36}$/);
        const { createdAt, ...response } = JSON.parse(raw);
        assert.equal(new Date(createdAt).toISOString(), createdAt);
        assert.deepEqual(response, {
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
    assert.equal(data.cursor, '');
    assert.equal(calls[0].prefix, 'rsvp:');
    assert.equal(calls[0].limit, 50);
    assert.equal(calls[0].cursor, 'previous-page');
    assert.equal((await post({ action: 'list', cursor: {} }, 'valid-session')).status, 400);
});

function element(tag) {
    return {
        tag, children: [], attributes: {}, textContent: '', handlers: {},
        appendChild(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(name, handler) { this.handlers[name] = handler; },
        click() { if (this.handlers.click) return this.handlers.click(); },
        remove() {}
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
    whatsapp: '+447700900123', sms: '+447700900124'
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
    const second = await createEvent(instance, { title: 'Second event', sms: '+447700900125' });
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
        { sms: '07700900123' }, { sms: '+0123456789' }, { sms: '+447700900123?body=bad' },
        { sms: '+123' }, { sms: '+1234567890123456' }, { sms: null },
        { sms: '+447700900123\n+447700900124' }
    ]) {
        assert.equal((await instance.post({ ...invitation, ...fields }, 'valid-session')).status, 400, JSON.stringify(fields));
    }
    assert.equal(instance.records.size, 0);
    for (const fields of [{ whatsapp: '' }, { sms: '' }, { whatsapp: '', sms: '' }]) {
        await createEvent(instance, fields);
    }
});

test('event-bound submissions reject mismatches and return only that event’s routing with a canonical receipt', async () => {
    const instance = api();
    const first = await createEvent(instance);
    const second = await createEvent(instance, { title: 'Another event', whatsapp: '', sms: '+447700900125' });
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
        assert.deepEqual(data.organiser, { whatsapp: event.whatsapp, sms: event.sms });
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
    const sms = new URL(links[1].href);
    assert.equal(sms.protocol, 'sms:');
    assert.equal(sms.pathname, invitation.sms);
    assert.equal(sms.searchParams.get('body'), message);
    assert.equal(rsvp.channels(response, {}).length, 0);
    assert.equal(rsvp.channels(response, { whatsapp: '+123', email: 'a@b.com\nBcc:x@y.com' }).length, 0);
    assert.equal(rsvp.channels(response, { email: 'a@b.com?bad' }).length, 0);
    assert.equal(rsvp.channels(response, { whatsapp: invitation.whatsapp }).length, 1);
    assert.equal(rsvp.channels(response, { sms: invitation.sms }).length, 1);
    for (const sms of ['+123', '07700900123', '+447700900124?body=bad', 'javascript:alert(1)']) {
        assert.equal(rsvp.channels(response, { sms }).length, 0);
    }
    const root = element('section');
    rsvp.sendOptions(root, { ...response, attending: 'no', guests: 0, notes: '' }, {});
    assert.equal(root.hidden, false);
    assert.match(root.children[0].textContent, /no external message has been sent/);
    rsvp.sendOptions(root, response, invitation);
    assert.equal(root.children.length, 3);
    assert.match(root.children[0].textContent, /Nothing has been sent/);
    assert.equal(root.children[1].rel, 'noopener noreferrer');
});

function browser({ page = 'index', storageFails = false, saved, failSave = false, expired = false, eventType, search,
    savedEvents, replyPages = [[]], exportExpired = false, clipboardFails = false } = {}) {
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
            ['id', 'title', 'text', 'whatsapp', 'sms', 'eventType'].map(id => [id, node('editor-' + id)])
        );
    }
    const event = { id: '12345678-1234-4123-8123-123456789012', title: 'Saved party', text: '<img src=x>\nSecond line', whatsapp: invitation.whatsapp, sms: invitation.sms };
    if (eventType !== undefined) event.eventType = eventType;
    const requests = [];
    const stored = new Map(saved ? [['rsvp_receipt', JSON.stringify(saved)]] : []);
    const redirects = [];
    const downloads = [];
    const copied = [];
    const context = {
        navigator: { clipboard: { async writeText(value) { if (clipboardFails) throw Error('denied'); copied.push(value); } } },
        URLSearchParams, document: {
            body: node('body'),
            createElement: element,
            createTextNode(text) { return { textContent: text }; },
            getElementById(id) {
                if ((id === 'loginForm' && page !== 'admin') || (id === 'rsvpForm' && page !== 'index') || (id === 'receipt' && page !== 'view')) return null;
                return node(id);
            },
            querySelector(selector) { return node(selector === '.eyebrow' ? 'eyebrow' : 'back'); }
        },
        sessionStorage: {
            setItem(key, value) { if (storageFails) throw Error('disabled'); stored.set(key, value); },
            getItem(key) { return stored.get(key); }
        },
        window: {
            RSVPExport: {
                csv(replies) { return { replies }; },
                workbook(events, replies) { return { events, replies }; },
                download(content, filename, type) { downloads.push({ content, filename, type }); }
            },
            location: { origin: 'https://example.com', search: search === undefined ? '?id=' + event.id : search, assign(path) { redirects.push(path); } }
        },
        fetch: async (path, options) => {
            const payload = JSON.parse(options.body);
            requests.push(payload);
            if (payload.action === 'get-invitation') return { ok: true, json: async () => ({ success: true, invitation: event }) };
            if (payload.action === 'verify') return { ok: true, json: async () => ({ success: true, sessionToken: 'valid-session' }) };
            if (['list', 'list-invitations'].includes(payload.action)) {
                assert.equal(options.headers['X-Admin-Session'], 'valid-session');
                if (exportExpired && requests.filter(item => item.action === 'list-invitations').length > 1) {
                    return { ok: false, status: 401, json: async () => ({ success: false, error: 'Unauthorized' }) };
                }
                if (payload.action === 'list-invitations') {
                    return { ok: true, json: async () => ({ success: true, invitations: savedEvents || [{ ...event, replyCount: 0 }], cursor: '' }) };
                }
                const index = Number(payload.cursor || 0);
                const responses = replyPages[index].filter(reply => !payload.eventId ||
                    (payload.eventId === 'unassigned' ? !reply.eventId : payload.eventId === reply.eventId));
                return { ok: true, json: async () => ({
                    success: true, responses, cursor: index + 1 < replyPages.length ? String(index + 1) : ''
                }) };
            }
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
    return { nodes, requests, stored, redirects, downloads, copied, event, tick: () => new Promise(resolve => setImmediate(resolve)) };
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
    assert.equal(app.requests.find(item => item.action === 'save-invitation').id, undefined);
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

test('event themes persist on invitations while legacy invitations default to classic', async () => {
    const instance = api();
    for (const eventType of ['celebration', 'weddings', 'parties', 'engagements']) {
        const event = await createEvent(instance, { eventType });
        const loaded = await (await instance.post({ action: 'get-invitation', id: event.id })).json();
        assert.equal(loaded.invitation.eventType, eventType);
        const updated = await createEvent(instance, { id: event.id, eventType });
        assert.equal(updated.id, event.id);
        assert.equal(updated.eventType, eventType);
    }
    assert.equal((await createEvent(instance)).eventType, 'celebration');
    for (const eventType of [null, {}, ['weddings'], 'unknown', '__proto__', '<script>']) {
        assert.equal((await instance.post({ ...invitation, eventType }, 'valid-session')).status, 400);
    }
    const legacy = await createEvent(instance);
    delete legacy.eventType;
    instance.records.set('rsvp-invitation:' + legacy.id, JSON.stringify(legacy));
    const loaded = await (await instance.post({ action: 'get-invitation', id: legacy.id })).json();
    assert.deepEqual(loaded.invitation, legacy);
});

test('landing pages have distinct themes and accessible navigation without public admin links', () => {
    for (const eventType of ['weddings', 'parties', 'engagements']) {
        const html = readFileSync(`${__dirname}/${eventType}/index.html`, 'utf8');
        assert.match(html, new RegExp(`data-event-type="${eventType}"`));
        assert.doesNotMatch(html, /href=["'][^"']*admin/i);
        assert.match(html, new RegExp(`href="/rsvp/${eventType}/" aria-current="page"`));
        assert.match(html, /example invitation/);
        assert.match(html, /unique .* link shared by your host/);
        assert.match(html, /href="\/rsvp\/landing.css"/);
        assert.doesNotMatch(html, /<form|<script/);
        const chooser = readFileSync(`${__dirname}/index.html`, 'utf8');
        assert.ok(chooser.includes(`href="/rsvp/${eventType}/"`));
        assert.doesNotMatch(chooser, /href=["'][^"']*admin|Organiser setup|sign in below/i);
    }
});

test('direct admin links preselect the theme, which is saved and restored when loading invitations', async () => {
    for (const eventType of ['weddings', 'parties', 'engagements']) {
        const app = browser({ page: 'admin', search: '?type=' + eventType });
        assert.equal(app.nodes['editor-eventType'].value, eventType);
        assert.equal(app.nodes.body.attributes['data-event-type'], eventType);
        await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
        await app.nodes.invitationForm.handlers.submit({ preventDefault() {} });
        assert.equal(app.requests.at(-1).eventType, eventType);
        assert.equal(app.nodes.shareInvitation.children[1].href, 'https://example.com/rsvp/?id=' + app.event.id);
        app.event.eventType = 'parties';
        await app.nodes.loadInvitation.handlers.click();
        assert.equal(app.nodes['editor-eventType'].value, 'parties');
        assert.equal(app.nodes.body.attributes['data-event-type'], 'parties');
        app.nodes.newInvitation.handlers.click();
        assert.equal(app.nodes['editor-eventType'].value, eventType);
        app.nodes['editor-eventType'].value = 'engagements';
        app.nodes['editor-eventType'].handlers.change();
        assert.equal(app.nodes.body.attributes['data-event-type'], 'engagements');
    }
    const invalid = browser({ page: 'admin', search: '?type=__proto__' });
    assert.equal(invalid.nodes['editor-eventType'].value, 'celebration');
});

test('guest and receipt retain saved event theme with safe fallback for old or unknown themes', async () => {
    for (const eventType of [undefined, 'unknown', 'weddings', 'parties', 'engagements']) {
        const app = browser({ eventType });
        await app.tick();
        const expected = !eventType || eventType === 'unknown' ? 'celebration' : eventType;
        assert.equal(app.nodes.body.attributes['data-event-type'], expected);
        assert.equal(app.nodes.occasionChooser.hidden, true);
        app.nodes.name.value = 'Guest';
        app.nodes.attending.value = 'yes';
        app.nodes.guests.value = '0';
        await app.nodes.rsvpForm.handlers.submit({ preventDefault() {} });
        const saved = JSON.parse(app.stored.get('rsvp_receipt'));
        assert.equal(saved.eventType, expected);
        const view = browser({ page: 'view', saved });
        assert.equal(view.nodes.body.attributes['data-event-type'], expected);
        assert.equal(view.nodes.back.href, '/rsvp/?id=' + app.event.id);
    }
});

test('invitation recall is admin-only, paginated, and counts same-type events by ID across all reply pages', async () => {
    const instance = api();
    const first = await createEvent(instance, { title: 'Wedding', eventType: 'weddings' });
    const second = await createEvent(instance, { title: 'Wedding', eventType: 'weddings' });
    for (let i = 0; i < 49; i++) await createEvent(instance);
    for (let i = 0; i < 1001; i++) {
        instance.records.set('rsvp:old-' + i, JSON.stringify({
            ...valid, eventId: i % 2 ? first.id : second.id
        }));
    }
    instance.records.set('rsvp:legacy', JSON.stringify(valid));
    for (const token of [undefined, 'invalid-session', 'other-user']) {
        assert.equal((await instance.post({ action: 'list-invitations' }, token)).status, 401);
    }
    const result = await instance.post({ action: 'list-invitations' }, 'valid-session');
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    const data = await result.json();
    assert.equal(data.invitations.length, 50);
    assert.equal(data.invitations[0].id, first.id);
    assert.equal(data.invitations[0].replyCount, 500);
    assert.equal(data.invitations[1].id, second.id);
    assert.equal(data.invitations[1].replyCount, 501);
    assert.equal(data.invitations[2].replyCount, 0);
    const next = await (await instance.post({ action: 'list-invitations', cursor: data.cursor }, 'valid-session')).json();
    assert.equal(next.invitations.length, 1);
    assert.equal(next.cursor, '');
    assert.equal((await instance.post({ action: 'list-invitations', cursor: 123 }, 'valid-session')).status, 400);
});

test('reply filtering preserves pagination, separates matching event titles, and includes unassigned legacy records', async () => {
    const instance = api();
    const first = await createEvent(instance, { title: 'Same title', eventType: 'parties' });
    const second = await createEvent(instance, { title: 'Same title', eventType: 'parties' });
    for (let i = 0; i < 50; i++) {
        instance.records.set('rsvp:old-' + i, JSON.stringify({ ...valid, eventId: first.id }));
    }
    await instance.post({ ...valid, event: second.title, eventId: second.id, createdAt: 'spoofed' });
    instance.records.set('rsvp:legacy', JSON.stringify(valid));
    const list = async fields => (await instance.post({ action: 'list', ...fields }, 'valid-session')).json();
    const empty = await list({ eventId: second.id });
    assert.equal(empty.responses.length, 0);
    assert.equal(empty.cursor, '50');
    const next = await list({ eventId: second.id, cursor: empty.cursor });
    assert.equal(next.responses.length, 1);
    assert.equal(next.responses[0].eventId, second.id);
    assert.notEqual(next.responses[0].createdAt, 'spoofed');
    assert.equal(next.cursor, '');
    const unassigned = await list({ eventId: 'unassigned', cursor: '50' });
    assert.equal(unassigned.responses.length, 1);
    assert.equal(unassigned.responses[0].eventId, undefined);
    assert.equal(unassigned.responses[0].createdAt, undefined);
    assert.equal((await list({ eventId: first.id })).responses.length, 50);
    assert.equal((await instance.post({ action: 'list', eventId: 'bad' }, 'valid-session')).status, 400);
});

test('legacy email invitations stay readable but email is ignored for routing and replaced on save', async () => {
    const instance = api();
    const event = await createEvent(instance);
    delete event.sms;
    event.email = 'legacy@example.com';
    instance.records.set('rsvp-invitation:' + event.id, JSON.stringify(event));
    const loaded = await (await instance.post({ action: 'get-invitation', id: event.id })).json();
    assert.equal(loaded.invitation.email, event.email);
    const reply = await (await instance.post({ ...valid, event: event.title, eventId: event.id })).json();
    assert.deepEqual(reply.organiser, { whatsapp: event.whatsapp, sms: '' });
    assert.equal(renderer().channels(reply.response, event).length, 1);
    const updated = await createEvent(instance, { ...event, sms: undefined });
    assert.equal(updated.sms, '');
    assert.equal(updated.email, undefined);
});

test('event panel recalls codes and links, opens editor, scopes replies and clears on logout', async () => {
    const app = browser({ page: 'admin' });
    await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.nodes.eventsPanel.hidden, false);
    const row = app.nodes.events.children[0];
    assert.equal(row.children[0].textContent, app.event.title);
    assert.match(row.children[1].textContent, /Replies: 0/);
    assert.equal(row.children[2].textContent, 'Invite code: ' + app.event.id);
    assert.equal(row.children[3].href, 'https://example.com/rsvp/?id=' + app.event.id);
    await row.children[4].click();
    await row.children[5].click();
    await app.tick();
    assert.deepEqual(app.copied, [app.event.id, row.children[3].href]);
    row.children[6].click();
    assert.equal(app.nodes['editor-id'].value, app.event.id);
    assert.equal(app.nodes['editor-sms'].value, app.event.sms);
    row.children[7].click();
    await app.tick();
    assert.equal(app.requests.at(-1).eventId, app.event.id);
    assert.equal(app.nodes.exportEvent.disabled, false);
    app.nodes.logout.handlers.click();
    assert.equal(app.nodes.eventsPanel.hidden, true);
    assert.equal(app.nodes.events.children.length, 0);
});

test('exports collect every reply page, isolate CSV events, include legacy records and require a live admin session', async () => {
    const id = '12345678-1234-4123-8123-123456789012';
    const replyPages = [[{ ...valid, name: 'First page', eventId: id }], [{ ...valid, name: 'Second page', eventId: id }, valid]];
    const app = browser({ page: 'admin', replyPages });
    await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.nodes.responses.children.length, 1);
    app.nodes.events.children[0].children[8].click();
    await app.tick();
    assert.equal(app.downloads[0].filename, 'rsvp-' + id + '.csv');
    assert.equal(app.downloads[0].content.replies.length, 2);
    assert.ok(app.downloads[0].content.replies.every(reply => reply.eventId === id));
    app.nodes.exportAll.handlers.click();
    await app.tick();
    assert.equal(app.downloads[1].filename, 'rsvp-all-events.xlsx');
    assert.equal(app.downloads[1].content.events.length, 1);
    assert.equal(app.downloads[1].content.replies.length, 3);
    app.nodes.logout.handlers.click();
    app.nodes.exportAll.handlers.click();
    await app.tick();
    assert.equal(app.downloads.length, 2);
    const expired = browser({ page: 'admin', exportExpired: true });
    await expired.nodes.loginForm.handlers.submit({ preventDefault() {} });
    expired.nodes.exportAll.handlers.click();
    await expired.tick();
    assert.equal(expired.downloads.length, 0);
    assert.equal(expired.nodes.eventsPanel.hidden, true);
    assert.equal(expired.nodes.message.textContent, 'Unauthorized');
});

function exporter() {
    const context = { window: {}, TextEncoder, Blob };
    runInNewContext(readFileSync(`${__dirname}/export.js`, 'utf8'), context);
    return context.window.RSVPExport;
}

async function unzipStored(blob) {
    const bytes = Buffer.from(await blob.arrayBuffer());
    const files = new Map();
    let offset = 0;
    while (bytes.readUInt32LE(offset) === 0x04034b50) {
        const size = bytes.readUInt32LE(offset + 18);
        const length = bytes.readUInt16LE(offset + 26);
        assert.equal(bytes.readUInt16LE(offset + 8), 0);
        const start = offset + 30 + length;
        files.set(bytes.toString('utf8', offset + 30, start), bytes.toString('utf8', start, start + size));
        offset = start + size;
    }
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
    assert.equal(bytes.readUInt16LE(bytes.length - 12), files.size);
    return files;
}

test('CSV quotes Unicode, commas and newlines, includes timestamps and neutralises spreadsheet formulas', () => {
    const csv = exporter().csv([{ name: '=1+1', event: 'Tea, "cake"', attending: 'yes', guests: 2,
        notes: 'Zoë\nhello', eventId: 'event-1', createdAt: '2026-10-24T12:00:00.000Z' }]);
    assert.ok(csv.startsWith('\ufeff"Name","Event","Attending","Additional Guests","Notes","Event ID","Submitted at (UTC)"\r\n'));
    assert.ok(csv.includes(`"'=1+1","Tea, ""cake""","Yes","2","Zoë\nhello","event-1","2026-10-24T12:00:00.000Z"`));
    for (const name of ['+SUM(1,1)', '-1+1', '@formula', '  =formula', '\tformula', '\rformula', '\nformula']) {
        assert.ok(exporter().csv([{ ...valid, name }]).includes(`"'${name.replace(/"/g, '""')}"`));
    }
    assert.ok(exporter().csv([valid]).endsWith('" Hello\nthere ","",""\r\n'));
});

test('XLSX creates separate safe worksheets for same-title events, empty events, orphaned IDs and legacy replies', async () => {
    const title = "'Wedding/party: a very long title [with] invalid* characters'";
    const events = [{ id: 'one', title }, { id: 'two', title }, { id: 'empty', title: 'History' }];
    const replies = [
        { ...valid, eventId: 'one', name: '=1+1', notes: '<&>\u0000', createdAt: '2026-10-24T12:00:00.000Z' },
        { ...valid, eventId: 'two', name: 'Zoë' },
        { ...valid, eventId: 'orphan', event: 'Removed event' },
        valid
    ];
    const files = await unzipStored(exporter().workbook(events, replies));
    const workbook = files.get('xl/workbook.xml');
    const names = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1]);
    assert.equal(names.length, 5);
    assert.equal(new Set(names.map(name => name.toLowerCase())).size, 5);
    assert.ok(names.every(name => name.length <= 31 && !/[\\/*?:[\]]/.test(name) && name.toLowerCase() !== 'history'));
    const first = files.get('xl/worksheets/sheet1.xml');
    assert.ok(first.includes('<t xml:space="preserve">=1+1</t>'));
    assert.ok(first.includes('&lt;&amp;&gt;'));
    assert.ok(first.includes('2026-10-24T12:00:00.000Z'));
    assert.doesNotMatch(first, /<f>|\u0000|Zoë/);
    assert.match(files.get('xl/worksheets/sheet2.xml'), /Zoë/);
    assert.equal((files.get('xl/worksheets/sheet3.xml').match(/<row>/g) || []).length, 1);
    assert.match(workbook, /Unassigned/);
    assert.match(files.get('[Content_Types].xml'), /spreadsheetml.sheet.main\+xml/);
    assert.match(files.get('_rels/.rels'), /Target="xl\/workbook.xml"/);
    const empty = await unzipStored(exporter().workbook([], []));
    assert.match(empty.get('xl/workbook.xml'), /Unassigned/);
});
