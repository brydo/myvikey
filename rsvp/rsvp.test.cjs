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
            delete: async key => records.delete(key),
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
    const admin = readFileSync(`${__dirname}/admin.html`, 'utf8');
    for (const channel of ['whatsapp', 'sms']) {
        assert.match(admin, new RegExp(`<input id="${channel}" name="${channel}" type="tel"`));
    }
    assert.doesNotMatch(admin, /name="email"/);
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

test('optional contact fields may be omitted, including WhatsApp for SMS-only invitations', async () => {
    const instance = api();
    for (const fields of [
        { whatsapp: undefined, sms: invitation.sms }, { whatsapp: invitation.whatsapp, sms: undefined },
        { whatsapp: undefined, sms: undefined }
    ]) {
        const event = await createEvent(instance, fields);
        assert.equal(event.whatsapp, fields.whatsapp === undefined ? '' : invitation.whatsapp);
        assert.equal(event.sms, fields.sms === undefined ? '' : invitation.sms);
        assert.deepEqual(JSON.parse(instance.records.get('rsvp-invitation:' + event.id)), event);
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

test('send options show only valid configured channels and explain unavailable text/SMS', () => {
    const rsvp = renderer();
    for (const [organiser, labels] of [
        [{ sms: invitation.sms }, ['Send via text/SMS']],
        [invitation, ['Send via WhatsApp', 'Send via text/SMS']],
        [{ whatsapp: invitation.whatsapp }, ['Send via WhatsApp']],
        ...[undefined, null, '', '+123', '07700900123', '+447700900124?body=bad', 447700900124]
            .flatMap(sms => [
                [{ sms }, []],
                [{ whatsapp: invitation.whatsapp, sms }, ['Send via WhatsApp']]
            ])
    ]) {
        const root = element('section');
        root.hidden = true;
        rsvp.sendOptions(root, valid, organiser);
        assert.equal(root.hidden, false);
        const buttons = root.children.filter(node => node.tag === 'a');
        assert.deepEqual(buttons.map(node => node.textContent), labels);
        assert.ok(buttons.every(node => !node.href.startsWith('mailto:')));
        if (!labels.includes('Send via text/SMS')) {
            assert.match(root.children[0].textContent, /(?:no valid WhatsApp or text\/SMS number|Text\/SMS is unavailable)/);
        }
        rsvp.sendOptions(root, valid, { sms: invitation.sms });
        assert.deepEqual(root.children.filter(node => node.tag === 'a').map(node => node.textContent),
            ['Send via text/SMS']);
    }
});

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
    savedEvents, replyPages = [[]], exportExpired = false, clipboardFails = false, apiPost, confirm = () => true } = {}) {
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
            confirm,
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
            if (path === '/api/rsvp' && apiPost) return apiPost(payload, options.headers['X-Admin-Session']);
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

test('deletion is admin-only, validates identifiers and cannot delete unrelated KV records', async () => {
    const instance = api();
    const event = await createEvent(instance);
    await instance.post(valid);
    const before = [...instance.records];
    for (const token of [undefined, 'invalid-session', 'other-user']) {
        for (const action of ['delete-reply', 'delete-event']) {
            assert.equal((await instance.post({ action, id: event.id, deleteReplies: true }, token)).status, 401);
        }
    }
    for (const id of [undefined, null, {}, '../private', 'sub_unrelated', 'rsvp:private']) {
        const action = id === 'sub_unrelated' ? 'delete-event' : 'delete-reply';
        assert.equal((await instance.post({ action, id, deleteReplies: true }, 'valid-session')).status, 400);
    }
    for (const deleteReplies of [undefined, null, 'true', 1]) {
        assert.equal((await instance.post({ action: 'delete-event', id: event.id, deleteReplies }, 'valid-session')).status, 400);
    }
    assert.equal((await instance.post({ action: 'delete-event', id: event.id, deleteReplies: true, cursor: {} }, 'valid-session')).status, 400);
    assert.deepEqual([...instance.records], before);
    instance.records.set('sub_unrelated', '{"private":true}');
    assert.equal((await instance.post({ action: 'delete-reply', id: 'sub_unrelated' }, 'valid-session')).status, 200);
    assert.ok(instance.records.has('sub_unrelated'));
});

test('reply IDs come from storage keys, support legacy replies and delete only the selected reply', async () => {
    const instance = api();
    await instance.post(valid);
    await instance.post(valid);
    instance.records.set('rsvp:legacy', JSON.stringify({ ...valid, id: 'spoofed' }));
    const listed = await (await instance.post({ action: 'list' }, 'valid-session')).json();
    assert.equal(listed.responses.at(-1).id, 'legacy');
    const id = listed.responses[0].id;
    const response = await instance.post({ action: 'delete-reply', id }, 'valid-session');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(instance.records.has('rsvp:' + id), false);
    assert.equal(instance.records.size, 2);
    assert.equal((await instance.post({ action: 'delete-reply', id }, 'valid-session')).status, 200);
    await instance.post({ action: 'delete-reply', id: 'legacy' }, 'valid-session');
    assert.equal(instance.records.size, 1);
});

test('deleting events keeps or removes replies explicitly and preserves other events and legacy records', async () => {
    for (const deleteReplies of [false, true]) {
        const instance = api();
        const event = await createEvent(instance);
        const other = await createEvent(instance, { title: event.title });
        for (const item of [event, other]) {
            await instance.post({ ...valid, event: item.title, eventId: item.id });
        }
        instance.records.set('rsvp:legacy', JSON.stringify(valid));
        instance.records.set('sub_unrelated', '{"private":true}');
        const result = await instance.post({ action: 'delete-event', id: event.id, deleteReplies }, 'valid-session');
        assert.equal(result.status, 200);
        assert.equal(instance.records.has('rsvp-invitation:' + event.id), false);
        assert.ok(instance.records.has('rsvp-invitation:' + other.id));
        assert.ok(instance.records.has('rsvp:legacy'));
        assert.ok(instance.records.has('sub_unrelated'));
        assert.equal((await instance.post({ action: 'get-invitation', id: event.id })).status, 404);
        assert.equal((await instance.post({ ...valid, event: event.title, eventId: event.id })).status, 404);
        const replies = await (await instance.post({ action: 'list' }, 'valid-session')).json();
        assert.equal(replies.responses.filter(reply => reply.eventId === event.id).length, deleteReplies ? 0 : 1);
        assert.equal(replies.responses.filter(reply => reply.eventId === other.id).length, 1);
    }
});

test('event cleanup is bounded, paginated and retryable after deletion failures', async () => {
    const instance = api();
    const event = await createEvent(instance);
    const other = await createEvent(instance);
    for (let i = 0; i < 120; i++) {
        instance.records.set('rsvp:' + i, JSON.stringify({ ...valid, eventId: i % 3 ? event.id : other.id }));
    }
    // KV cursors remain valid after deletion; use stable positions rather than shifting array offsets.
    const keys = [...instance.records.keys()].filter(key => key.startsWith('rsvp:'));
    instance.env.FORM_SUBMISSIONS.list = async options => {
        assert.equal(options.limit, 50);
        const offset = Number(options.cursor) || 0;
        const end = offset + options.limit;
        return { keys: keys.slice(offset, end).filter(key => instance.records.has(key)).map(name => ({ name })),
            list_complete: end >= keys.length, cursor: end >= keys.length ? '' : String(end) };
    };
    const remove = instance.env.FORM_SUBMISSIONS.delete;
    instance.env.FORM_SUBMISSIONS.delete = async key => {
        if (key.startsWith('rsvp:')) throw Error('private failure');
        return remove(key);
    };
    let response = await instance.post({ action: 'delete-event', id: event.id, deleteReplies: true }, 'valid-session');
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /private failure/);
    assert.equal(instance.records.has('rsvp-invitation:' + event.id), false);
    instance.env.FORM_SUBMISSIONS.delete = remove;
    let cursor = '';
    let pages = 0;
    do {
        response = await instance.post({ action: 'delete-event', id: event.id, deleteReplies: true, cursor }, 'valid-session');
        assert.equal(response.status, 200);
        cursor = (await response.json()).cursor;
        pages++;
    } while (cursor);
    assert.equal(pages, 3);
    assert.equal([...instance.records.keys()].filter(key => key.startsWith('rsvp:')).length, 40);
    assert.ok(instance.records.has('rsvp-invitation:' + other.id));
});

test('a submission finishing after event deletion removes its late reply', async () => {
    const instance = api();
    const event = await createEvent(instance);
    const put = instance.env.FORM_SUBMISSIONS.put;
    instance.env.FORM_SUBMISSIONS.put = async (key, value) => {
        if (key.startsWith('rsvp:')) {
            const deleted = await instance.post({ action: 'delete-event', id: event.id, deleteReplies: true }, 'valid-session');
            assert.equal(deleted.status, 200);
        }
        return put(key, value);
    };
    const reply = await instance.post({ ...valid, event: event.title, eventId: event.id });
    assert.equal(reply.status, 404);
    assert.equal([...instance.records.keys()].filter(key => key.startsWith('rsvp:')).length, 0);
});

test('admin deletion requires confirmation, offers keep/delete choice and refreshes counts and editor', async () => {
    for (const choice of ['keep', 'delete']) {
        const instance = api();
        const event = await createEvent(instance);
        await instance.post({ ...valid, event: event.title, eventId: event.id });
        let approved = false;
        const warnings = [];
        const admin = browser({ page: 'admin', apiPost: instance.post,
            confirm(warning) { warnings.push(warning); return approved; } });
        await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
        let row = admin.nodes.events.children[0];
        const find = (root, label) => root.children.find(node => node.tag === 'button' && node.textContent === label);
        const replyCard = admin.nodes.responses.children[0];
        await find(replyCard, 'Delete reply').click();
        assert.equal(admin.requests.filter(item => item.action.startsWith('delete-')).length, 0);
        await find(row, 'Delete event').click();
        assert.equal(admin.requests.filter(item => item.action.startsWith('delete-')).length, 0);
        assert.match(warnings.at(-1), /link will stop working/);
        approved = true;
        await find(replyCard, 'Delete reply').click();
        assert.equal(admin.nodes.responses.children.length, 0);
        assert.match(admin.nodes.events.children[0].children[1].textContent, /Replies: 0/);
        await instance.post({ ...valid, event: event.title, eventId: event.id });
        await admin.nodes.refresh.handlers.click();
        row = admin.nodes.events.children[0];
        find(row, 'Open/Edit').click();
        row.children.find(node => node.tag === 'select').value = choice;
        await find(row, 'Delete event').click();
        assert.equal(admin.requests.find(item => item.action === 'delete-event').deleteReplies, choice === 'delete');
        assert.match(warnings.at(-1), choice === 'delete' ? /replies will also be permanently deleted/ : /replies will be kept/);
        assert.equal(admin.nodes.events.children.length, 0);
        assert.equal(admin.nodes['editor-id'].value, '');
        assert.equal(admin.nodes.shareInvitation.children.length, 0);
        assert.equal(admin.nodes.responses.children.length, choice === 'keep' ? 1 : 0);
    }
});

test('admin follows cleanup cursors and prevents duplicate deletion while a request is pending', async () => {
    const instance = api();
    const event = await createEvent(instance);
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const pages = [];
    const admin = browser({ page: 'admin', apiPost: async (payload, token) => {
        if (payload.action === 'delete-event') {
            pages.push(payload.cursor);
            if (!payload.cursor) {
                await pending;
                return Response.json({ success: true, cursor: 'next-page' });
            }
        }
        return instance.post(payload, token);
    } });
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    const row = admin.nodes.events.children[0];
    row.children.find(node => node.tag === 'select').value = 'delete';
    const button = row.children.find(node => node.textContent === 'Delete event');
    const deleting = button.click();
    await button.click();
    assert.deepEqual(pages, ['']);
    finish();
    await deleting;
    assert.deepEqual(pages, ['', 'next-page']);
    assert.equal(instance.records.has('rsvp-invitation:' + event.id), false);
    assert.equal(admin.nodes.events.children.length, 0);
});

test('admin deletion reports failures and logs out on an expired session without clearing unsaved editor state on storage failure', async () => {
    for (const expired of [false, true]) {
        const instance = api();
        const event = await createEvent(instance);
        const admin = browser({ page: 'admin', apiPost: (payload, token) => {
            if (payload.action === 'delete-event' && expired) {
                return instance.post(payload, 'invalid-session');
            }
            return instance.post(payload, token);
        } });
        await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
        const row = admin.nodes.events.children[0];
        row.children.find(node => node.textContent === 'Open/Edit').click();
        instance.env.FORM_SUBMISSIONS.delete = async () => { throw Error('private failure'); };
        await row.children.find(node => node.textContent === 'Delete event').click();
        assert.match(admin.nodes.message.textContent, /Deletion did not complete/);
        assert.doesNotMatch(admin.nodes.message.textContent, /private failure/);
        assert.ok(instance.records.has('rsvp-invitation:' + event.id));
        if (expired) {
            assert.equal(admin.nodes.loginForm.hidden, false);
            assert.equal(admin.nodes.invitationForm.hidden, true);
            assert.equal(admin.nodes.events.children.length, 0);
        } else {
            assert.equal(admin.nodes['editor-id'].value, event.id);
            assert.equal(admin.nodes.events.children.length, 1);
        }
    }
});

test('failed bulk cleanup can be retried after refreshing, reopening admin or signing back in', async () => {
    const instance = api();
    const event = await createEvent(instance);
    await instance.post({ ...valid, event: event.title, eventId: event.id });
    const admin = browser({ page: 'admin', apiPost: instance.post });
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    const remove = instance.env.FORM_SUBMISSIONS.delete;
    instance.env.FORM_SUBMISSIONS.delete = async key => {
        if (key.startsWith('rsvp:')) throw Error('failure');
        return remove(key);
    };
    const row = admin.nodes.events.children[0];
    row.children.find(node => node.tag === 'select').value = 'delete';
    await row.children.find(node => node.textContent === 'Delete event').click();
    assert.equal(instance.records.has('rsvp-invitation:' + event.id), false);
    assert.equal(admin.nodes.deletionJobs.children.length, 1);
    await admin.nodes.refresh.handlers.click();
    assert.equal(admin.nodes.events.children.length, 0);
    assert.equal(admin.nodes.deletionJobs.children.length, 1);
    const jobs = admin.stored.get('rsvp_delete_jobs');
    assert.deepEqual(JSON.parse(jobs), [event.id]);
    admin.nodes.logout.handlers.click();
    assert.equal(admin.nodes.deletionJobs.children.length, 0);
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    assert.equal(admin.nodes.deletionJobs.children.length, 1);
    const reopened = browser({ page: 'admin', apiPost: instance.post });
    reopened.stored.set('rsvp_delete_jobs', jobs);
    await reopened.nodes.loginForm.handlers.submit({ preventDefault() {} });
    assert.equal(reopened.nodes.deletionJobs.children.length, 1);
    instance.env.FORM_SUBMISSIONS.delete = remove;
    await reopened.nodes.deletionJobs.children[0].click();
    assert.equal(reopened.nodes.deletionJobs.children.length, 0);
    assert.equal(reopened.nodes.responses.children.length, 0);
    assert.deepEqual(JSON.parse(reopened.stored.get('rsvp_delete_jobs')), []);
});

test('real API organiser routing preserves SMS from admin save/load through guest submit and confirmation', async () => {
    for (const whatsapp of ['', invitation.whatsapp]) {
        const instance = api();
        const admin = browser({ page: 'admin', apiPost: instance.post });
        await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
        for (const [field, value] of Object.entries({ ...invitation, whatsapp })) {
            if (field !== 'action') admin.nodes['editor-' + field].value = value;
        }
        await admin.nodes.invitationForm.handlers.submit({ preventDefault() {} });
        const id = admin.nodes['editor-id'].value;
        assert.ok(id);
        admin.nodes['editor-sms'].value = '';
        await admin.nodes.loadInvitation.handlers.click();
        assert.equal(admin.nodes['editor-sms'].value, invitation.sms);
        assert.equal(admin.nodes['editor-whatsapp'].value, whatsapp);

        const guest = browser({ search: '?id=' + id, apiPost: instance.post });
        await guest.tick();
        guest.nodes.name.value = 'SMS guest';
        guest.nodes.attending.value = 'yes';
        guest.nodes.guests.value = '0';
        guest.nodes.notes.value = 'See you there!';
        await guest.nodes.rsvpForm.handlers.submit({ preventDefault() {} });
        assert.deepEqual(guest.redirects, ['/rsvp/view']);
        const saved = JSON.parse(guest.stored.get('rsvp_receipt'));
        assert.deepEqual(saved.organiser, { whatsapp, sms: invitation.sms });
        const receipt = browser({ page: 'view', saved });
        for (const app of [guest, receipt]) {
            const buttons = app.nodes.sendOptions.children.filter(node => node.tag === 'a');
            assert.deepEqual(buttons.map(node => node.textContent),
                whatsapp ? ['Send via WhatsApp', 'Send via text/SMS'] : ['Send via text/SMS']);
            const sms = new URL(buttons.at(-1).href);
            assert.equal(sms.pathname, invitation.sms);
            assert.match(sms.searchParams.get('body'), /Name: SMS guest/);
            assert.match(sms.searchParams.get('body'), /Notes: See you there!/);
        }
        assert.equal(receipt.nodes.back.href, '/rsvp/?id=' + id);
        assert.equal([...instance.records.keys()].filter(key => key.startsWith('rsvp:')).length, 1);
    }
});

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
    for (const eventType of ['celebration', 'events', 'weddings', 'parties', 'engagements']) {
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
    for (const eventType of ['events', 'weddings', 'parties', 'engagements']) {
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

test('events landing page uses shared assets and is linked from the RSVP index', () => {
    const html = readFileSync(`${__dirname}/events/index.html`, 'utf8');
    const chooser = readFileSync(`${__dirname}/index.html`, 'utf8');
    assert.match(html, /href="\/rsvp\/card\.css"/);
    assert.match(html, /href="\/rsvp\/landing\.css"/);
    assert.match(html, /href="\/rsvp\/events\/" aria-current="page"/);
    assert.match(html, /href="\/rsvp\/weddings\/"/);
    assert.match(html, /href="\/rsvp\/parties\/"/);
    assert.match(html, /href="\/rsvp\/engagements\/"/);
    assert.match(chooser, /href="\/rsvp\/events\/"/);
    assert.match(html, /data-event-type="events"/);
    assert.doesNotMatch(html, /<form|<script|href=["'][^"']*admin/i);
});

test('admin theme options match the shared card themes, including Events tokens and banner', () => {
    const html = readFileSync(`${__dirname}/admin.html`, 'utf8');
    const selector = html.match(/<select id="eventType" name="eventType">([\s\S]*?)<\/select>/)[1];
    assert.deepEqual([...selector.matchAll(/<option value="([^"]+)">/g)].map(match => match[1]),
        ['celebration', 'events', 'weddings', 'parties', 'engagements']);
    assert.match(selector, /<option value="events">Events · versatile celebration<\/option>/);
    const css = readFileSync(`${__dirname}/card.css`, 'utf8');
    const tokens = css.match(/body\[data-event-type="events"\] \{([^}]+)\}/)[1];
    for (const token of ['accent', 'accent-hover', 'ink', 'paper', 'border']) {
        assert.ok(tokens.includes(`--${token}:`));
    }
    assert.match(css, /body\[data-event-type="events"\] \.rsvp-banner \{/);
    assert.match(css, /body\[data-event-type="events"\] \.rsvp-banner::before,/);
    assert.match(css, /body\[data-event-type="events"\] \.rsvp-banner::after \{/);
});

test('direct admin links preselect the theme, which is saved and restored when loading invitations', async () => {
    for (const eventType of ['events', 'weddings', 'parties', 'engagements']) {
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

test('Events invitation round-trips from admin through API storage to guest and receipt', async () => {
    const instance = api();
    const admin = browser({ page: 'admin', search: '?type=events', apiPost: instance.post });
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    for (const field of ['title', 'text', 'whatsapp', 'sms']) {
        admin.nodes['editor-' + field].value = invitation[field];
    }
    await admin.nodes.invitationForm.handlers.submit({ preventDefault() {} });
    const id = admin.nodes['editor-id'].value;
    assert.equal(JSON.parse(instance.records.get('rsvp-invitation:' + id)).eventType, 'events');
    admin.nodes['editor-eventType'].value = 'weddings';
    await admin.nodes.loadInvitation.handlers.click();
    assert.equal(admin.nodes['editor-eventType'].value, 'events');
    assert.equal(admin.nodes.body.attributes['data-event-type'], 'events');
    const guest = browser({ search: '?id=' + id, apiPost: instance.post });
    await guest.tick();
    assert.equal(guest.nodes.body.attributes['data-event-type'], 'events');
    guest.nodes.name.value = 'Guest';
    guest.nodes.attending.value = 'yes';
    guest.nodes.guests.value = '0';
    await guest.nodes.rsvpForm.handlers.submit({ preventDefault() {} });
    const saved = JSON.parse(guest.stored.get('rsvp_receipt'));
    assert.equal(saved.eventType, 'events');
    const receipt = browser({ page: 'view', saved });
    assert.equal(receipt.nodes.body.attributes['data-event-type'], 'events');
    assert.equal(receipt.nodes.back.href, '/rsvp/?id=' + id);
});

test('guest and receipt retain saved event theme with safe fallback for old or unknown themes', async () => {
    const labels = {
        celebration: 'Together is a beautiful place to be',
        events: 'Made for your moment · made to share',
        weddings: 'A beautiful beginning, shared with our favourite people',
        parties: 'Good company. Great memories. Let’s celebrate!',
        engagements: 'Here’s to forever, and the people who make it sparkle'
    };
    for (const eventType of [undefined, null, 'unknown', '__proto__', {}, ['events'], ...Object.keys(labels)]) {
        const app = browser({ eventType });
        await app.tick();
        const expected = Object.keys(labels).includes(eventType) ? eventType : 'celebration';
        assert.equal(app.nodes.body.attributes['data-event-type'], expected);
        assert.equal(app.nodes.eyebrow.textContent, labels[expected]);
        assert.equal(app.nodes.occasionChooser.hidden, true);
        app.nodes.name.value = 'Guest';
        app.nodes.attending.value = 'yes';
        app.nodes.guests.value = '0';
        await app.nodes.rsvpForm.handlers.submit({ preventDefault() {} });
        const saved = JSON.parse(app.stored.get('rsvp_receipt'));
        assert.equal(saved.eventType, expected);
        const view = browser({ page: 'view', saved: { ...saved, eventType } });
        assert.equal(view.nodes.body.attributes['data-event-type'], expected);
        assert.equal(view.nodes.eyebrow.textContent, labels[expected]);
        assert.equal(view.nodes.back.href, '/rsvp/?id=' + app.event.id);
    }
});

test('invitation recall is admin-only, paginated, and bounded regardless of response volume', async () => {
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
    assert.equal(data.invitations[1].id, second.id);
    assert.equal(instance.calls.length, 1);
    assert.equal(instance.calls[0].prefix, 'rsvp-invitation:');
    const next = await (await instance.post({ action: 'list-invitations', cursor: data.cursor }, 'valid-session')).json();
    assert.equal(next.invitations.length, 1);
    assert.equal(next.cursor, '');
    assert.equal(instance.calls.length, 2);
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
    const restored = await createEvent(instance, { ...updated, sms: invitation.sms });
    assert.equal(restored.id, event.id);
    const routed = await (await instance.post({ ...valid, event: event.title, eventId: event.id })).json();
    const view = browser({ page: 'view', saved: routed });
    assert.deepEqual(view.nodes.sendOptions.children.filter(node => node.tag === 'a').map(node => node.textContent),
        ['Send via WhatsApp', 'Send via text/SMS']);
    assert.equal(view.nodes.back.href, '/rsvp/?id=' + event.id);
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

test('reply filters skip empty pages, separate same-title events and keep clipboard fallback usable', async () => {
    const savedEvents = [
        { id: '11111111-1111-4111-8111-111111111111', title: 'Wedding', eventType: 'weddings' },
        { id: '22222222-2222-4222-8222-222222222222', title: 'Wedding', eventType: 'weddings' }
    ];
    const app = browser({ page: 'admin', clipboardFails: true, savedEvents, replyPages: [
        [{ ...valid, eventId: savedEvents[0].id, name: 'First wedding' }],
        [{ ...valid, eventId: savedEvents[1].id, name: 'Second wedding' }]
    ] });
    await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
    assert.match(app.nodes.events.children[0].children[1].textContent, /Replies: 1/);
    assert.match(app.nodes.events.children[1].children[1].textContent, /Replies: 1/);
    app.nodes.replyEvent.value = savedEvents[1].id;
    app.nodes.replyEvent.handlers.change();
    await app.tick();
    assert.equal(app.nodes.responses.children.length, 1);
    assert.equal(app.nodes.responses.children[0].children[2].children[1].textContent, 'Second wedding');
    assert.equal(app.nodes.more.hidden, true);
    app.nodes.events.children[1].children[4].click();
    await app.tick();
    assert.match(app.nodes.message.textContent, /Select and copy/);
});

test('exports collect every reply page, isolate CSV events, include legacy records and require a live admin session', async () => {
    const id = '12345678-1234-4123-8123-123456789012';
    const replyPages = [[{ ...valid, name: 'First page', eventId: id }], [{ ...valid, name: 'Second page', eventId: id }, valid]];
    const app = browser({ page: 'admin', replyPages });
    await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.nodes.responses.children.length, 1);
    assert.match(app.nodes.events.children[0].children[1].textContent, /Replies: 2/);
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
