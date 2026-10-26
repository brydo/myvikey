const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');
const themesSource = readFileSync(`${__dirname}/themes.js`, 'utf8').replace(/^export /gm, '');
const idsSource = readFileSync(`${__dirname}/invitation-id.js`, 'utf8').replace(/^export /gm, '');
const ids = runInNewContext(idsSource + '\n({ invitationId, invitationShortId, invitationPath })');
const apiSource = themesSource + '\n' + idsSource + '\n' + readFileSync(`${__dirname}/../functions/api/rsvp.js`, 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');
const appearanceModel = runInNewContext(themesSource +
    '\n({ copyFields, styleFields, defaultCopy, defaultCardStyle, normalizeAppearance, validateAppearance, contrastIssues, buttonHover })', { URL });
const plain = value => JSON.parse(JSON.stringify(value));
// Saved settings carry a server-owned revision; compare everything else exactly.
const unrevised = value => { const { updatedAt, ...rest } = plain(value); return rest; };

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
    runInNewContext(apiSource, context);
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
    runInNewContext(apiSource, context);
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
        tag, children: [], attributes: {}, textContent: '', handlers: {}, parentNode: null,
        classList: {
            values: new Set(),
            add(value) { this.values.add(value); },
            remove(value) { this.values.delete(value); },
            contains(value) { return this.values.has(value); },
            toggle(value, force) {
                if (force === undefined) force = !this.values.has(value);
                if (force) this.add(value);
                else this.remove(value);
                return force;
            }
        },
        style: { setProperty(key, value) { this[key] = value; } },
        appendChild(child) {
            if (child.parentNode) child.remove();
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        replaceChildren(...children) {
            this.children.forEach(child => { child.parentNode = null; });
            this.children = [];
            children.forEach(child => this.appendChild(child));
        },
        setAttribute(key, value) { this.attributes[key] = String(value); },
        getAttribute(key) { return this.attributes[key] ?? null; },
        removeAttribute(key) { delete this.attributes[key]; },
        matches(selector) {
            const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
            const value = attribute && (this.attributes[attribute[1]] ?? this[attribute[1]]);
            return attribute ? value !== undefined &&
                (attribute[2] === undefined || value === attribute[2]) : this.tag === selector;
        },
        closest(selector) {
            for (let current = this; current; current = current.parentNode) {
                if (current.matches && current.matches(selector)) return current;
            }
            return null;
        },
        querySelectorAll(selector) {
            return this.children.flatMap(child => [
                ...(child.matches && child.matches(selector) ? [child] : []),
                ...(child.querySelectorAll ? child.querySelectorAll(selector) : [])
            ]);
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
        addEventListener(name, handler) { this.handlers[name] = handler; },
        click() { if (this.handlers.click) return this.handlers.click(); },
        remove() {
            if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
            this.parentNode = null;
        }
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
        const { shortId, passwordProtected, ...stored } = event;
        assert.deepEqual(JSON.parse(instance.records.get('rsvp-invitation:' + event.id)), stored);
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
            assert.ok(root.children.some(node =>
                /(?:no valid WhatsApp or text\/SMS number|Text\/SMS is unavailable)/.test(node.textContent)));
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
    assert.deepEqual(Array.from(links, link => link.copyKey), ['whatsappLabel', 'smsLabel']);
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

function browser({ page = 'index', storageFails = false, saved, failSave = false, expired = false, eventType, search, appearanceFails = false,
    savedEvents, replyPages = [[]], exportExpired = false, clipboardFails = false, apiPost, confirm = () => true, localStore } = {}) {
    const nodes = {};
    function node(id) {
        if (!nodes[id]) nodes[id] = {
            ...element('div'), hidden: true, value: '', disabled: false, handlers: {},
            addEventListener(name, callback) { this.handlers[name] = callback; },
            focus() { this.focused = true; },
            reset() {
                if (this.elements) Object.values(this.elements).forEach(field => { field.value = ''; });
            },
            querySelector(selector) { return element('div').querySelector.call(this, selector) || node(id + 'Button'); }
        };
        return nodes[id];
    }
    const html = readFileSync(`${__dirname}/${page === 'landing' ? (eventType === 'celebration' ? 'index' : eventType + '/index') : page}.html`, 'utf8');
    const stack = [];
    for (const match of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)\b([^>]*?)>/gi)) {
        if (!match[1]) continue;
        const tag = match[1].toLowerCase();
        if (match[0].startsWith('</')) {
            const index = stack.findLastIndex(parent => parent.tag === tag);
            if (index !== -1) stack.length = index;
            continue;
        }
        const attributes = [...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)];
        const id = attributes.find(attribute => attribute[1] === 'id')?.[2];
        const current = tag === 'body' ? node('body') : id ? node(id) : element(tag);
        current.tag = tag;
        attributes.forEach(([, key, value = '']) => {
            current.setAttribute(key, value);
            if (['name', 'type', 'value'].includes(key)) current[key] = value;
        });
        if (stack.length) stack.at(-1).appendChild(current);
        if (current.attributes.class === 'eyebrow') nodes.eyebrow = current;
        if (!['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr'].includes(tag)) stack.push(current);
    }
    if (page === 'admin') {
        Object.defineProperty(node('appearanceForm'), 'elements', {
            get() { return Object.fromEntries(this.querySelectorAll('[name]').map(field => [field.name, field])); }
        });
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
        setTimeout, clearTimeout, AbortController,
        Image: class {
            set src(value) {
                if (value) Promise.resolve().then(() => { if (this.onload) this.onload(); });
            }
            decode() { return Promise.resolve(); }
        },
        navigator: { clipboard: { async writeText(value) { if (clipboardFails) throw Error('denied'); copied.push(value); } } },
        URL, URLSearchParams, document: {
            body: node('body'),
            createElement: element,
            createTextNode(text) { return { textContent: text }; },
            getElementById(id) {
                if ((['loginForm', 'appearanceForm', 'backgroundImage'].includes(id) && page !== 'admin') ||
                    (id === 'rsvpForm' && page !== 'index') || (id === 'receipt' && page !== 'view')) return null;
                return node(id);
            },
            querySelector(selector) {
                if (selector === 'nav a') {
                    const link = node('body').querySelector('nav')?.querySelector('a');
                    if (link) return (nodes.back = link);
                }
                return node(selector === '.eyebrow' ? 'eyebrow' : 'back');
            }
        },
        sessionStorage: {
            setItem(key, value) { if (storageFails) throw Error('disabled'); stored.set(key, value); },
            getItem(key) { return stored.get(key); }
        },
        localStorage: localStore && {
            setItem(key, value) { localStore.set(key, value); },
            getItem(key) { return localStore.has(key) ? localStore.get(key) : null; }
        },
        window: {
            confirm,
            RSVPExport: {
                csv(replies) { return { replies }; },
                workbook(events, replies) { return { events, replies }; },
                download(content, filename, type) { downloads.push({ content, filename, type }); }
            },
            location: { origin: 'https://example.com', search: search === undefined ? (page === 'index' ? '?id=' + event.id : '') : search, assign(path) { redirects.push(path); } }
        },
        fetch: async (path, options) => {
            const payload = JSON.parse(options.body);
            requests.push(payload);
            if (payload.action === 'get-appearance' && appearanceFails) throw Error('offline');
            if (path === '/api/rsvp' && apiPost) return apiPost(payload, options.headers['X-Admin-Session']);
            if (payload.action === 'get-appearance') return { ok: true, json: async () => ({ success: true }) };
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
    if (page === 'landing') node('body').setAttribute('data-event-type', eventType);
    runInNewContext(themesSource + '\n' + readFileSync(`${__dirname}/theme-client.js`, 'utf8').replace(/^import .*;\n/gm, ''), context);
    runInNewContext(readFileSync(`${__dirname}/card-render.js`, 'utf8'), context);
    if (page !== 'landing') runInNewContext(idsSource + '\n' + readFileSync(`${__dirname}/rsvp.js`, 'utf8').replace(/^import .*;\n/gm, ''), context);
    return { nodes, requests, stored, redirects, downloads, copied, event, themes: context.window.RSVPThemes,
        tick: () => new Promise(resolve => setImmediate(resolve)) };
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
        assert.deepEqual(guest.redirects, ['/rsvp/view?type=celebration&id=' + ids.invitationShortId(id)]);
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
        assert.equal(receipt.nodes.back.href, ids.invitationPath(id));
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
    assert.equal(app.requests.find(item => item.action === 'submit').eventId, app.event.id);
    assert.deepEqual(app.redirects, ['/rsvp/view?type=celebration&id=' + ids.invitationShortId(app.event.id)]);
    const receipt = JSON.parse(app.stored.get('rsvp_receipt'));
    const view = browser({ page: 'view', saved: receipt });
    assert.equal(view.nodes.receipt.children.length, 1);
    assert.equal(view.nodes.sendOptions.children.length, 3);
    assert.equal(view.nodes.back.href, ids.invitationPath(app.event.id));
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
    assert.equal(app.requests.find(item => item.action === 'verify').id, '__admin__');
    assert.equal(app.nodes.invitationForm.hidden, false);
    for (const [field, value] of Object.entries(invitation)) {
        if (field !== 'action') app.nodes['editor-' + field].value = value;
    }
    await app.nodes.invitationForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.requests.find(item => item.action === 'save-invitation').id, undefined);
    assert.equal(app.nodes['editor-id'].value, app.event.id);
    const link = app.nodes.shareInvitation.children[1];
    assert.equal(link.href, 'https://example.com' + ids.invitationPath(app.event.id));
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
    assert.deepEqual(loaded.invitation, { ...legacy, eventType: 'celebration' });
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
        assert.doesNotMatch(html, /<form/);
        assert.match(html, /type="module" src="\/rsvp\/theme-client.js"/);
        const chooser = readFileSync(`${__dirname}/index.html`, 'utf8');
        assert.ok(chooser.includes(`href="/rsvp/${eventType}/"`));
        assert.doesNotMatch(chooser, /href=["'][^"']*admin|Organiser setup|sign in below/i);
    }
});

for (const eventType of ['events', 'weddings', 'parties', 'engagements']) {
    test(`${eventType} landing header has complete theme navigation and one current page`, () => {
        const html = readFileSync(`${__dirname}/${eventType}/index.html`, 'utf8');
        const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/);
        assert.ok(header, `${eventType} must have a header`);
        const nav = header[1].match(/<nav\b[^>]*aria-label="Event themes"[^>]*>([\s\S]*?)<\/nav>/);
        assert.ok(nav, `${eventType} header must have Event themes navigation`);
        const links = [...nav[1].matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)];
        assert.deepEqual(links.map(([, attributes, label]) => ({
            href: attributes.match(/\bhref="([^"]*)"/)?.[1],
            label: label.trim(),
            current: attributes.match(/\baria-current="([^"]*)"/)?.[1]
        })), ['Events', 'Weddings', 'Parties', 'Engagements'].map(label => ({
            href: `/rsvp/${label.toLowerCase()}/`,
            label,
            current: label.toLowerCase() === eventType ? 'page' : undefined
        })));
    });
}

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
    assert.doesNotMatch(html, /<form|href=["'][^"']*admin/i);
    assert.match(html, /src="\/rsvp\/theme-client.js"/);
});

const halloween = 'https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/ween.jpg';
const categories = ['celebration', 'events', 'weddings', 'parties', 'engagements'];

function contrastRatio(first, second) {
    const luminance = color => {
        const components = color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return components.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('all five category settings authenticate writes, round-trip independently and retain legacy background-only updates', async () => {
    const instance = api();
    for (const eventType of categories) {
        const settings = {
            action: 'save-appearance', eventType, backgroundImage: '',
            copy: { brand: eventType + ' studio', receiptMessage: '  Cafe\u0301\r\nWelcome  ' },
            cardStyle: { surface: '#FFF', textColor: '#123', headingColor: '#234', bodyScale: 1.2, alignment: 'left' }
        };
        for (const token of [undefined, 'invalid-session', 'other-user']) {
            assert.equal((await instance.post(settings, token)).status, 401);
        }
        const saved = await instance.post(settings, 'valid-session');
        assert.equal(saved.status, 200);
        assert.equal(saved.headers.get('Cache-Control'), 'no-store');
        const normalized = unrevised(appearanceModel.normalizeAppearance(eventType, settings));
        const savedAppearance = (await saved.json()).appearance[eventType];
        assert.deepEqual(unrevised(savedAppearance), normalized);
        assert.ok(savedAppearance.updatedAt > 0);
        assert.equal(normalized.copy.receiptMessage, 'Café\nWelcome');
        assert.equal(normalized.cardStyle.surface, '#ffffff');
        assert.deepEqual(unrevised(JSON.parse(instance.records.get('rsvp-appearance:' + eventType))), normalized);
        const legacy = await instance.post({
            action: 'save-appearance', eventType, backgroundImage: 'https://images.example.com/' + eventType
        }, 'valid-session');
        const updated = (await legacy.json()).appearance[eventType];
        assert.deepEqual(updated.copy, normalized.copy);
        assert.deepEqual(updated.cardStyle, normalized.cardStyle);
    }
    const publicSettings = (await (await instance.post({ action: 'get-appearance' })).json()).appearance;
    for (const eventType of categories) {
        assert.equal(publicSettings[eventType].copy.brand, eventType + ' studio');
    }
});

test('copy fields normalize trim NFC and CRLF, honor each bound, and reject markup controls and non-text without writes', async () => {
    const instance = api();
    const base = { action: 'save-appearance', eventType: 'events', backgroundImage: '' };
    for (const [key, field] of Object.entries(appearanceModel.copyFields)) {
        const maximum = 'x'.repeat(field.max);
        assert.equal(appearanceModel.validateAppearance('events', { backgroundImage: '', copy: { [key]: maximum } }).copy[key], maximum);
        for (const value of ['x'.repeat(field.max + 1), '<b>text</b>', 'a>b', 'a\u0000b', 'a\u0007b', 'a\u007fb', 'a\u0085b', null, 4, {}, []]) {
            const candidate = { backgroundImage: '', copy: { [key]: value } };
            assert.equal(appearanceModel.validateAppearance('events', candidate), null, key + ': ' + JSON.stringify(value));
            assert.equal((await instance.post({ ...base, copy: candidate.copy }, 'valid-session')).status, 400);
        }
        const normalized = appearanceModel.normalizeAppearance('events', { copy: { [key]: '  Cafe\u0301\r\nagain\rline  ' } });
        assert.equal(normalized.copy[key], 'Café\nagain\nline', key);
    }
    for (const copy of [null, [], 'text', 1, { unknownField: 'private' }]) {
        assert.equal((await instance.post({ ...base, copy }, 'valid-session')).status, 400);
    }
    for (const extra of [{ css: 'body{display:none}' }, { secret: 'private' }, { title: 'Host content' }]) {
        assert.equal((await instance.post({ ...base, ...extra }, 'valid-session')).status, 400);
    }
    assert.equal(instance.records.size, 0);
});

test('required public labels reject blank values while optional decorative copy may be cleared', async () => {
    const required = ['inviteHeading', 'openRsvp', 'replyHeading', 'nameLabel', 'eventLabel',
        'attendingLabel', 'chooseLabel', 'yesLabel', 'noLabel', 'guestsLabel', 'notesLabel',
        'receiptNotesLabel', 'saveReply', 'receiptHeading', 'receiptEmptyHeading', 'backLink', 'cardHeading',
        'whatsappLabel', 'smsLabel', 'landingHeading', 'sampleHeading', 'detailsHeading', 'step1Heading',
        'step2Heading', 'step3Heading', 'exploreLink', 'homeLink', 'occasionHeading'];
    const instance = api();
    for (const key of required) {
        assert.equal(appearanceModel.copyFields[key].required, true, key);
        for (const value of ['', ' \r\n\t ']) {
            assert.equal(appearanceModel.validateAppearance('events', { backgroundImage: '', copy: { [key]: value } }), null, key);
            assert.equal(appearanceModel.normalizeAppearance('events', { copy: { [key]: value } }).copy[key],
                appearanceModel.defaultCopy('events')[key]);
            assert.equal((await instance.post({ action: 'save-appearance', eventType: 'events', backgroundImage: '', copy: { [key]: value } }, 'valid-session')).status, 400);
        }
    }
    assert.equal(appearanceModel.validateAppearance('events', { backgroundImage: '', copy: { landingExtra: '' } }).copy.landingExtra, '');
});

test('card styles allow only hex colors and known alignment, enforce finite numbers and clamp supported ranges', async () => {
    const instance = api();
    const base = { action: 'save-appearance', eventType: 'weddings', backgroundImage: '' };
    for (const key of ['surface', 'textColor', 'headingColor']) {
        for (const value of ['red', 'transparent', 'rgb(0,0,0)', '#ffff', '#000000ff', '#123456; color:red', 'var(--ink)', 'url(https://example.com)', null, {}, 1]) {
            assert.equal((await instance.post({ ...base, cardStyle: { [key]: value } }, 'valid-session')).status, 400, key + ': ' + value);
        }
    }
    for (const [key, field] of Object.entries(appearanceModel.styleFields).filter(([, field]) => field.type === 'number')) {
        for (const value of [NaN, Infinity, -Infinity, '1', null, {}, []]) {
            assert.equal(appearanceModel.validateAppearance('weddings', { backgroundImage: '', cardStyle: { [key]: value } }), null);
            assert.equal((await instance.post({ ...base, cardStyle: { [key]: value } }, 'valid-session')).status, 400);
        }
        for (const [value, expected] of [[-100, field.min], [1000, field.max]]) {
            const response = await instance.post({ ...base, cardStyle: { [key]: value } }, 'valid-session');
            assert.equal(response.status, 200);
            assert.equal((await response.json()).appearance.weddings.cardStyle[key], expected);
        }
    }
    for (const cardStyle of [null, [], 'text', { unknown: 1 }, { alignment: 'right' }, { alignment: 'left; color:red' }]) {
        assert.equal((await instance.post({ ...base, cardStyle }, 'valid-session')).status, 400);
    }
});

test('heading and body colors require at least 4.5 contrast and normalization repairs unreadable combinations', async () => {
    const instance = api();
    for (const type of categories) {
        for (const key of ['textColor', 'headingColor']) {
            for (const surface of ['#ffffff', '#000000', '#777777']) {
                const cardStyle = { surface, [key]: surface };
                assert.equal(appearanceModel.validateAppearance(type, { backgroundImage: '', cardStyle }), null);
                assert.equal((await instance.post({ action: 'save-appearance', eventType: type, backgroundImage: '', cardStyle }, 'valid-session')).status, 400);
                const normalized = appearanceModel.normalizeAppearance(type, { cardStyle }).cardStyle;
                for (const color of ['textColor', 'headingColor']) assert.ok(contrastRatio(normalized[color], normalized.surface) >= 4.5);
            }
        }
        const response = await instance.post({ action: 'save-appearance', eventType: type, backgroundImage: '',
            cardStyle: { surface: '#000', textColor: '#fff', headingColor: '#fff' } }, 'valid-session');
        assert.equal(response.status, 200);
    }
});

test('malformed and legacy stored settings fall back safely and public reads allowlist every nested field', async () => {
    const instance = api();
    for (const type of categories) {
        for (const raw of ['{', 'null', '[]', '"text"', '7']) {
            instance.records.set('rsvp-appearance:' + type, raw);
            const data = (await (await instance.post({ action: 'get-appearance' })).json()).appearance[type];
            assert.deepEqual(data, plain(appearanceModel.normalizeAppearance(type, {})));
        }
        const backgroundImage = 'https://images.example.com/legacy.jpg';
        instance.records.set('rsvp-appearance:' + type, JSON.stringify({ backgroundImage }));
        let settings = (await (await instance.post({ action: 'get-appearance' })).json()).appearance[type];
        assert.deepEqual(settings, plain(appearanceModel.normalizeAppearance(type, { backgroundImage })));
        instance.records.set('rsvp-appearance:' + type, JSON.stringify({
            backgroundImage: 'javascript:alert(1)', secret: 'private',
            copy: { brand: 'Valid brand', unknown: 'private', inviteText: '<script>bad</script>' },
            cardStyle: { textColor: 'url(https://evil)', surface: '#000000', secret: 'private', alignment: 'bad', spacing: 1000 }
        }));
        settings = (await (await instance.post({ action: 'get-appearance' })).json()).appearance[type];
        assert.deepEqual(Object.keys(settings).sort(), ['backgroundImage', 'cardStyle', 'copy', 'updatedAt']);
        assert.deepEqual(Object.keys(settings.copy).sort(), Object.keys(appearanceModel.copyFields).sort());
        assert.deepEqual(Object.keys(settings.cardStyle).sort(), Object.keys(appearanceModel.styleFields).sort());
        assert.equal(settings.copy.brand, 'Valid brand');
        assert.equal(settings.copy.inviteText, appearanceModel.defaultCopy(type).inviteText);
        assert.equal(settings.cardStyle.spacing, appearanceModel.styleFields.spacing.max);
        assert.doesNotMatch(JSON.stringify(settings), /private|javascript:|<script>|url\(https:\/\/evil/i);
        assert.ok(contrastRatio(settings.cardStyle.textColor, settings.cardStyle.surface) >= 4.5);
    }
});

test('public appearance reads expose only whitelisted category settings and preserve defaults', async () => {
    const instance = api();
    const event = await createEvent(instance, { eventType: 'events' });
    await instance.post({ ...valid, event: event.title, eventId: event.id });
    instance.records.set('sub_private', '{"password":"private"}');
    instance.records.set('rsvp-appearance:private', '{"secret":"private"}');
    const response = await instance.post({ action: 'get-appearance' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const data = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ['appearance', 'success']);
    assert.deepEqual(Object.keys(data.appearance).sort(), [...categories].sort());
    for (const type of categories) {
        assert.deepEqual(data.appearance[type], plain(appearanceModel.normalizeAppearance(type, {})));
    }
    assert.equal(instance.calls.length, 0, 'Public settings never list invitations or replies');
    assert.doesNotMatch(JSON.stringify(data), new RegExp(event.id + '|private|' + event.title));
});

test('only trusted admins can persist bounded safe HTTPS category backgrounds', async () => {
    const instance = api();
    const settings = { action: 'save-appearance', eventType: 'events', backgroundImage: 'https://images.example.com/party.jpg?v=2&size=large' };
    for (const token of [undefined, 'invalid-session', 'other-user']) {
        assert.equal((await instance.post(settings, token)).status, 401);
    }
    assert.equal(instance.records.size, 0);
    for (const backgroundImage of [
        undefined, null, {}, [], 3, 'http://example.com/a.jpg', '//example.com/a.jpg',
        'javascript:alert(1)', 'data:image/svg+xml,bad', 'https://', '******example.com/a',
        'https://example.com/a.jpg");color:red;/*', 'https://example.com/a\\b',
        'https://example.com/a\nb', 'https://example.com/<img>', 'https://example.com/' + 'a'.repeat(2048)
    ]) {
        assert.equal((await instance.post({ ...settings, backgroundImage }, 'valid-session')).status, 400, String(backgroundImage));
    }
    for (const eventType of ['unknown', '__proto__', null, {}, ['events']]) {
        assert.equal((await instance.post({ ...settings, eventType }, 'valid-session')).status, 400);
    }
    assert.equal(instance.records.size, 0);
    assert.equal((await instance.post(settings, 'valid-session')).status, 200);
    assert.deepEqual(unrevised(JSON.parse(instance.records.get('rsvp-appearance:events'))),
        unrevised(appearanceModel.normalizeAppearance('events', settings)));
    const data = await (await instance.post({ action: 'get-appearance' })).json();
    assert.equal(data.appearance.events.backgroundImage, settings.backgroundImage);
    assert.equal(data.appearance.weddings.backgroundImage, '');
    assert.equal((await instance.post({ ...settings, backgroundImage: '' }, 'valid-session')).status, 200);
    assert.equal((await (await instance.post({ action: 'get-appearance' })).json()).appearance.events.backgroundImage, '');
});

test('every category uses its current saved background across landing, existing invitation, form, receipt and reply card', async () => {
    for (const eventType of categories) {
        const instance = api();
        const event = await createEvent(instance, { eventType });
        const original = instance.records.get('rsvp-invitation:' + event.id);
        const backgroundImage = 'https://images.example.com/' + eventType + '.jpg';
        const admin = browser({ page: 'admin', search: '?type=' + eventType, apiPost: instance.post });
        await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
        await admin.tick();
        assert.equal(admin.nodes.appearanceForm.hidden, false);
        admin.nodes.backgroundImage.value = backgroundImage;
        const copy = {
            brand: eventType + ' brand', tagline: eventType + ' tagline',
            landingHeading: eventType + ' landing', landingTagline: eventType + ' landing tagline',
            inviteHeading: 'Category heading must not replace invitation',
            inviteText: 'Category message must not replace invitation', openRsvp: eventType + ' respond',
            nameLabel: eventType + ' name', cardHeading: eventType + ' reply',
            yesLabel: eventType + ' yes', receiptHeading: eventType + ' thank you',
            receiptMessage: eventType + ' saved', smsLabel: eventType + ' text'
        };
        const cardStyle = { surface: '#ffffff', textColor: '#222222', headingColor: '#111111', alignment: 'left', spacing: 24 };
        for (const [key, value] of Object.entries(copy)) admin.nodes.appearanceForm.elements['copy-' + key].value = value;
        for (const [key, value] of Object.entries(cardStyle)) admin.nodes.appearanceForm.elements['style-' + key].value = value;
        await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
        assert.equal(instance.records.get('rsvp-invitation:' + event.id), original, 'Settings must not rewrite invitations');
        const landing = browser({ page: 'landing', eventType, search: '', apiPost: instance.post });
        const guest = browser({ search: '?id=' + event.id, apiPost: instance.post });
        await Promise.all([landing.tick(), guest.tick()]);
        assert.equal(landing.requests.some(item => item.action === 'get-invitation'), false);
        const expected = 'url("' + backgroundImage + '")';
        for (const app of [admin, landing, guest]) {
            assert.equal(app.nodes.body.style['--category-image'], expected);
            assert.equal(app.nodes.body.attributes['data-event-type'], eventType);
            assert.equal(app.nodes.body.style['--card-surface'], '#ffffff');
            assert.equal(app.nodes.body.style['--card-text'], '#222222');
            assert.equal(app.nodes.body.style['--card-heading'], '#111111');
            assert.equal(app.nodes.body.style['--card-alignment'], 'left');
            assert.equal(app.nodes.body.style['--card-spacing'], '24px');
        }
        for (const app of [landing, guest]) {
            for (const bound of app.nodes.body.querySelectorAll('[data-copy]')) {
                const key = bound.getAttribute('data-copy');
                if (Object.hasOwn(copy, key)) assert.equal(bound.textContent, copy[key], eventType + ': ' + key);
            }
        }
        assert.equal(guest.nodes.heading.textContent, event.title);
        assert.equal(guest.nodes.invitationText.textContent, event.text);
        guest.nodes.openRsvp.handlers.click();
        assert.equal(guest.nodes.rsvpForm.hidden, false);
        assert.equal(guest.nodes.body.style['--category-image'], expected);
        guest.nodes.name.value = 'Guest';
        guest.nodes.attending.value = 'yes';
        guest.nodes.guests.value = '0';
        await guest.nodes.rsvpForm.handlers.submit({ preventDefault() {} });
        const saved = JSON.parse(guest.stored.get('rsvp_receipt'));
        assert.equal(saved.response.eventType, eventType);
        const receipt = browser({ page: 'view', search: guest.redirects[0].split('?')[1] ? '?' + guest.redirects[0].split('?')[1] : '',
            saved, apiPost: instance.post });
        await receipt.tick();
        assert.equal(receipt.nodes.body.style['--category-image'], expected);
        assert.equal(receipt.nodes.receipt.children[0].style['--category-image'], expected);
        assert.equal(receipt.nodes.receiptHeading.textContent, copy.receiptHeading);
        assert.equal(receipt.nodes.message.textContent, copy.receiptMessage);
        assert.equal(receipt.nodes.receipt.children[0].children[1].textContent, copy.cardHeading);
        assert.equal(receipt.nodes.sendOptions.children.at(-1).textContent, copy.smsLabel);
        assert.equal(receipt.nodes.back.href, ids.invitationPath(event.id));
        await admin.nodes.refresh.handlers.click();
        assert.equal(admin.nodes.responses.children[0].style['--category-image'], expected);
        assert.equal(admin.nodes.responses.children[0].querySelectorAll('[data-copy="cardHeading"]')[0].textContent, copy.cardHeading);
        await admin.nodes.logout.handlers.click();
        assert.equal(admin.nodes.appearanceForm.hidden, true);
    }
});

test('Events Halloween default is shared even when appearance loading fails', async () => {
    for (const page of ['landing', 'index', 'view', 'admin']) {
        const app = browser({ page, eventType: 'events', appearanceFails: true,
            search: page === 'index' ? undefined : '?type=events',
            saved: page === 'view' ? { response: valid, eventType: 'events' } : undefined });
        await app.tick();
        assert.equal(app.nodes.body.style['--category-image'], 'url("' + halloween + '")');
        assert.equal(await app.themes.ready, false);
    }
    const css = readFileSync(`${__dirname}/card.css`, 'utf8');
    assert.match(css, /--backdrop-color: #0d0d11/);
    for (const rule of ['background-size: cover', 'background-position: center', 'background-attachment: fixed', 'background-repeat: no-repeat']) {
        assert.ok(css.includes(rule));
    }
});

test('mixed admin reply cards resolve category by invitation ID, including legacy replies, without changing the preview', async () => {
    const instance = api();
    const first = await createEvent(instance, { title: 'Same title', eventType: 'events' });
    const second = await createEvent(instance, { title: 'Same title', eventType: 'weddings' });
    for (const eventType of categories) {
        assert.equal((await instance.post({ action: 'save-appearance', eventType,
            backgroundImage: eventType === 'events' ? halloween : '',
            copy: { cardHeading: eventType + ' custom card', nameLabel: eventType + ' custom name' },
            cardStyle: { spacing: eventType === 'events' ? 23 : 25 }
        }, 'valid-session')).status, 200);
    }
    for (const event of [first, second]) {
        await instance.post({ ...valid, event: event.title, eventId: event.id, eventType: 'parties' });
    }
    instance.records.set('rsvp:old', JSON.stringify({ ...valid, eventId: second.id }));
    instance.records.set('rsvp:unassigned', JSON.stringify(valid));
    const admin = browser({ page: 'admin', search: '?type=parties', apiPost: instance.post });
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    await admin.tick();
    assert.deepEqual(admin.nodes.responses.children.map(card => card.attributes['data-event-type']),
        ['events', 'weddings', 'weddings', 'celebration']);
    assert.equal(admin.nodes.responses.children[0].style['--category-image'], 'url("' + halloween + '")');
    assert.equal(admin.nodes.responses.children[1].style['--category-image'], 'var(--backdrop)');
    for (const [index, eventType] of ['events', 'weddings', 'weddings', 'celebration'].entries()) {
        const card = admin.nodes.responses.children[index];
        assert.equal(card.querySelectorAll('[data-copy="cardHeading"]')[0].textContent, eventType + ' custom card');
        assert.equal(card.querySelectorAll('[data-copy="nameLabel"]')[0].textContent, eventType + ' custom name');
    }
    assert.equal(admin.nodes.responses.children[0].style['--card-spacing'], '23px');
    assert.equal(admin.nodes.responses.children[1].style['--card-spacing'], '25px');
    assert.equal(admin.nodes.body.attributes['data-event-type'], 'parties');
    const replies = await (await instance.post({ action: 'list', eventId: first.id }, 'valid-session')).json();
    assert.equal(replies.responses.length, 1);
    assert.equal(replies.responses[0].eventId, first.id);
    await instance.post({ action: 'delete-event', id: first.id, deleteReplies: false }, 'valid-session');
    const retained = await (await instance.post({ action: 'list' }, 'valid-session')).json();
    assert.equal(retained.responses[0].eventType, 'events', 'Deleted invitations retain server-saved category');
});

test('receipts load current appearance and invitation category, retain legacy fallback, and never show a different invitation receipt', async () => {
    const instance = api();
    const event = await createEvent(instance, { eventType: 'events' });
    const saved = { response: { ...valid, eventId: event.id, eventType: 'events' }, eventType: 'events', organiser: invitation };
    await createEvent(instance, { ...event, eventType: 'engagements' });
    await instance.post({ action: 'save-appearance', eventType: 'engagements', backgroundImage: 'https://images.example.com/new.jpg',
        copy: { receiptHeading: 'Current category thanks', cardHeading: 'Current category reply',
            sendHelp: 'Current category send help', whatsappLabel: 'Current WhatsApp', smsLabel: 'Current text' }
    }, 'valid-session');
    const receipt = browser({ page: 'view', saved, apiPost: instance.post });
    await receipt.tick();
    assert.equal(receipt.nodes.body.attributes['data-event-type'], 'engagements');
    assert.equal(receipt.nodes.receipt.children[0].attributes['data-event-type'], 'engagements');
    assert.equal(receipt.nodes.body.style['--category-image'], 'url("https://images.example.com/new.jpg")');
    assert.equal(receipt.nodes.receiptHeading.textContent, 'Current category thanks');
    assert.equal(receipt.nodes.receipt.children[0].children[1].textContent, 'Current category reply');
    assert.equal(receipt.nodes.sendOptions.getAttribute('data-event-type'), 'engagements');
    assert.equal(receipt.nodes.sendOptions.children[0].textContent, 'Current category send help');
    assert.deepEqual(receipt.nodes.sendOptions.children.filter(node => node.tag === 'a').map(node => node.textContent),
        ['Current WhatsApp', 'Current text']);
    const empty = browser({ page: 'view', search: '?type=events&id=' + event.id, apiPost: instance.post });
    await empty.tick();
    assert.equal(empty.nodes.body.attributes['data-event-type'], 'engagements');
    assert.equal(empty.nodes.back.href, ids.invitationPath(event.id));
    assert.equal(empty.nodes.receipt.children.length, 0);
    const other = await createEvent(instance, { eventType: 'weddings' });
    const mismatch = browser({ page: 'view', saved, search: '?type=weddings&id=' + other.id, apiPost: instance.post });
    await mismatch.tick();
    assert.equal(mismatch.nodes.receipt.children.length, 0);
    const legacy = browser({ page: 'view', saved: valid, appearanceFails: true });
    assert.equal(legacy.nodes.body.attributes['data-event-type'], 'celebration');
});

test('client rejects unsafe appearance responses and keeps defaults on failed settings requests', async () => {
    const app = browser({ page: 'landing', eventType: 'events', appearanceFails: true, search: '' });
    await app.tick();
    app.themes.update({ events: { backgroundImage: 'javascript:alert(1)' }, weddings: { backgroundImage: 'https://host/a");color:red' } });
    assert.equal(app.nodes.body.style['--category-image'], 'url("' + halloween + '")');
    app.themes.apply(app.nodes.body, '__proto__');
    assert.equal(app.nodes.body.attributes['data-event-type'], 'celebration');
    assert.equal(app.nodes.body.style['--category-image'], 'var(--backdrop)');
});

test('client paints only normalized allowlisted copy and style values, including malformed settings responses', async () => {
    const app = browser({ page: 'landing', eventType: 'weddings', appearanceFails: true, search: '' });
    await app.tick();
    for (const settings of [null, [], 'text', { weddings: null }, { weddings: [] }]) {
        app.themes.update(settings);
        assert.deepEqual(plain(app.themes.settings('weddings')), plain(appearanceModel.normalizeAppearance('weddings', {})));
    }
    app.themes.update({ weddings: {
        copy: { landingHeading: '  Cafe\u0301\r\nWedding  ', brand: '<img src=x onerror=alert(1)>', nameLabel: '',
            secret: 'private' },
        cardStyle: { surface: '#fff', textColor: '#fff', headingColor: 'red; background:url(https://evil)',
            bodyScale: Infinity, spacing: 100, alignment: 'left; color:red', unknown: 'private' }
    } });
    const settings = app.themes.settings('weddings');
    assert.equal(app.nodes.body.querySelectorAll('[data-copy="landingHeading"]')[0].textContent, 'Café\nWedding');
    assert.equal(settings.copy.brand, appearanceModel.defaultCopy('weddings').brand);
    assert.equal(settings.copy.nameLabel, appearanceModel.defaultCopy('weddings').nameLabel);
    assert.equal(settings.cardStyle.spacing, 32);
    assert.equal(app.nodes.body.style['--card-spacing'], '32px');
    assert.equal(app.nodes.body.style['--card-body-scale'], '1');
    assert.equal(app.nodes.body.style['--card-alignment'], 'center');
    for (const key of ['textColor', 'headingColor']) assert.ok(contrastRatio(settings.cardStyle[key], settings.cardStyle.surface) >= 4.5);
    assert.doesNotMatch(JSON.stringify(settings), /private|onerror|background:url/i);
});

test('admin category resets synchronize the background input after deletion and logout', async () => {
    const instance = api();
    const event = await createEvent(instance, { eventType: 'weddings' });
    const admin = browser({ page: 'admin', search: '?type=events', apiPost: instance.post });
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    await admin.tick();
    admin.nodes['editor-id'].value = event.id;
    await admin.nodes.loadInvitation.handlers.click();
    assert.equal(admin.nodes.backgroundImage.value, '');
    admin.nodes.logout.handlers.click();
    assert.equal(admin.nodes['editor-eventType'].value, 'events');
    assert.equal(admin.nodes.backgroundImage.value, halloween);
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    admin.nodes['editor-id'].value = event.id;
    await admin.nodes.loadInvitation.handlers.click();
    const row = admin.nodes.events.children[0];
    await row.children.find(node => node.tag === 'button' && node.textContent === 'Delete event').click();
    assert.equal(admin.nodes['editor-eventType'].value, 'events');
    assert.equal(admin.nodes.backgroundImage.value, halloween);
});

test('a slow initial appearance read cannot overwrite a newer authenticated settings save', async () => {
    const instance = api();
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const admin = browser({ page: 'admin', search: '?type=events', apiPost: async (payload, token) => {
        if (payload.action === 'get-appearance') {
            await pending;
            return Response.json({ success: true, appearance: { events: { backgroundImage: halloween } } });
        }
        return instance.post(payload, token);
    } });
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    admin.nodes.backgroundImage.value = 'https://images.example.com/new.jpg';
    admin.nodes.appearanceForm.elements['copy-brand'].value = 'Newer saved brand';
    admin.nodes.appearanceForm.elements['style-spacing'].value = 27;
    await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
    finish();
    await admin.tick();
    assert.equal(admin.nodes.body.style['--category-image'], 'url("https://images.example.com/new.jpg")');
    assert.equal(admin.nodes.backgroundImage.value, 'https://images.example.com/new.jpg');
    assert.equal(admin.themes.copy('events', 'brand'), 'Newer saved brand');
    assert.equal(admin.themes.settings('events').cardStyle.spacing, 27);
});

test('template copy bindings use known fields and keep invitation-owned preview content outside category bindings', () => {
    const pages = ['index', 'view', 'admin', ...categories.filter(type => type !== 'celebration').map(type => type + '/index')];
    for (const page of pages) {
        const html = readFileSync(`${__dirname}/${page}.html`, 'utf8');
        const bindings = [...html.matchAll(/\bdata-copy="([^"]+)"/g)].map(match => match[1]);
        assert.ok(bindings.length >= (page === 'view' ? 4 : page === 'admin' ? 8 : 10), page);
        for (const key of bindings) assert.ok(Object.hasOwn(appearanceModel.copyFields, key), page + ': ' + key);
    }
    const admin = readFileSync(`${__dirname}/admin.html`, 'utf8');
    for (const id of ['copyEditor', 'styleEditor', 'appearancePreview', 'resetAppearance']) assert.ok(admin.includes('id="' + id + '"'));
    for (const id of ['previewInvitationTitle', 'previewInvitationText']) {
        const tag = admin.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'))[0];
        assert.doesNotMatch(tag, /data-copy=/);
    }
});

test('chooser links and receipt branding inherit contrast-safe custom card text instead of category accent', () => {
    const css = readFileSync(`${__dirname}/card.css`, 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const selector of ['.occasion-chooser a', '.page-head .brand']) {
        const rule = rules.find(([, selectors, declarations]) =>
            selectors.split(',').map(value => value.trim()).includes(selector) &&
            /(?:^|;)\s*color:\s*inherit\s*;/.test(declarations));
        assert.ok(rule, selector + ' must inherit validated foreground color');
    }
    for (const selector of ['.occasion-chooser', '.page-head']) {
        assert.ok(rules.some(([, selectors, declarations]) =>
            selectors.split(',').map(value => value.trim()).includes(selector) &&
            declarations.includes('color: var(--card-text, var(--ink))') &&
            declarations.includes('background: var(--card-surface, var(--paper))')));
    }
    const settings = appearanceModel.validateAppearance('celebration', {
        backgroundImage: '', cardStyle: { surface: '#844456', textColor: '#ffffff', headingColor: '#ffffff' }
    });
    assert.ok(settings, 'An accent-colored surface with contrasting white text is valid');
    assert.ok(contrastRatio(settings.cardStyle.textColor, settings.cardStyle.surface) >= 4.5);
});

test('admin creates bounded named controls, previews draft changes locally, switches categories and resets before publishing', async () => {
    const instance = api();
    const admin = browser({ page: 'admin', search: '?type=weddings', apiPost: instance.post });
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    await admin.tick();
    const fields = admin.nodes.appearanceForm.elements;
    for (const [key, metadata] of Object.entries(appearanceModel.copyFields)) {
        const input = fields['copy-' + key];
        assert.equal(input.tag, 'textarea', key);
        assert.equal(input.maxLength, metadata.max);
        assert.equal(input.required, metadata.required, key);
        assert.equal(input.value, appearanceModel.defaultCopy('weddings')[key]);
    }
    for (const [key, metadata] of Object.entries(appearanceModel.styleFields)) {
        const input = fields['style-' + key];
        assert.equal(metadata.type === 'select' ? input.tag : input.type, metadata.type);
        if (metadata.type === 'number') {
            assert.equal(input.min, metadata.min);
            assert.equal(input.max, metadata.max);
            assert.equal(input.step, metadata.step);
        }
    }
    const before = plain(admin.themes.settings('weddings'));
    fields['copy-brand'].value = 'Draft studio';
    fields['style-spacing'].value = 30;
    fields['style-alignment'].value = 'left';
    admin.nodes['editor-title'].value = 'Only this invitation';
    admin.nodes['editor-text'].value = 'Host-owned text';
    admin.nodes.appearanceForm.handlers.input();
    assert.equal(admin.nodes.appearancePreview.querySelectorAll('[data-copy="brand"]')[0].textContent, 'Draft studio');
    assert.equal(admin.nodes.appearancePreview.style['--card-spacing'], '30px');
    assert.equal(admin.nodes.appearancePreview.style['--card-alignment'], 'left');
    assert.equal(admin.nodes.previewInvitationTitle.textContent, 'Only this invitation');
    assert.equal(admin.nodes.previewInvitationText.textContent, 'Host-owned text');
    assert.deepEqual(plain(admin.themes.settings('weddings')), before);
    assert.equal(admin.nodes.body.style['--card-spacing'], before.cardStyle.spacing + 'px');
    assert.equal(instance.records.has('rsvp-appearance:weddings'), false);
    admin.nodes.backgroundImage.value = 'https://images.example.com/keep.jpg';
    admin.nodes.resetAppearance.click();
    assert.equal(fields['copy-brand'].value, appearanceModel.defaultCopy('weddings').brand);
    assert.equal(fields['style-spacing'].value, appearanceModel.defaultCardStyle('weddings').spacing);
    assert.equal(admin.nodes.backgroundImage.value, 'https://images.example.com/keep.jpg');
    assert.equal(instance.records.has('rsvp-appearance:weddings'), false);
    await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
    assert.ok(instance.records.has('rsvp-appearance:weddings'));
    admin.nodes['editor-eventType'].value = 'events';
    admin.nodes['editor-eventType'].handlers.change();
    assert.equal(fields['copy-tagline'].value, appearanceModel.defaultCopy('events').tagline);
    assert.equal(admin.nodes.backgroundImage.value, halloween);
    assert.equal(admin.nodes.appearancePreview.getAttribute('data-event-type'), 'events');
});

test('admin appearance save errors retain drafts and saved settings, while expired auth hides protected controls', async () => {
    for (const failure of ['storage', 'validation', 'auth']) {
        const instance = api();
        const admin = browser({ page: 'admin', search: '?type=parties', apiPost: (payload, token) =>
            instance.post(payload, failure === 'auth' && payload.action === 'save-appearance' ? 'invalid-session' : token) });
        await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
        await admin.tick();
        const field = admin.nodes.appearanceForm.elements['copy-brand'];
        field.value = failure === 'validation' ? '<script>bad</script>' : 'Keep my draft';
        if (failure === 'storage') instance.env.FORM_SUBMISSIONS.put = async () => { throw Error('private storage detail'); };
        const before = plain(admin.themes.settings('parties'));
        await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
        assert.deepEqual(plain(admin.themes.settings('parties')), before);
        assert.equal(instance.records.has('rsvp-appearance:parties'), false);
        assert.doesNotMatch(admin.nodes.appearanceStatus.textContent, /private storage detail/);
        assert.equal(admin.nodes.appearanceForm.querySelector('button').disabled, false);
        if (failure === 'auth') {
            assert.equal(admin.nodes.appearanceForm.hidden, true);
            assert.equal(admin.nodes.loginForm.hidden, false);
        } else {
            assert.equal(admin.nodes.appearanceForm.hidden, false);
            assert.equal(field.value, failure === 'validation' ? '<script>bad</script>' : 'Keep my draft');
            assert.match(admin.nodes.appearanceStatus.textContent, failure === 'validation' ? /plain text|valid card settings/ : /unavailable|failed|unable/i);
            assert.match(admin.nodes.appearanceStatus.textContent, /^Not saved\..*still here\.$/);
            assert.equal(admin.nodes.appearanceStatus.getAttribute('data-state'), 'error');
        }
    }
});

test('late category loading repaints existing invitation receipt and reply labels without changing host content or nested categories', async () => {
    const instance = api();
    const event = await createEvent(instance, { eventType: 'events' });
    const appearance = {
        events: { backgroundImage: '', copy: { tagline: 'Late event tagline', inviteHeading: 'Never overwrite host',
            inviteText: 'Never overwrite host text', cardHeading: 'Late event card', receiptHeading: 'Late thanks',
            receiptMessage: 'Late saved', nameLabel: 'Late guest', smsLabel: 'Late text' },
        cardStyle: { surface: '#ffffff', textColor: '#222222', headingColor: '#111111', spacing: 26 } },
        weddings: { copy: { cardHeading: 'Wedding only', nameLabel: 'Wedding guest' } }
    };
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const apiPost = async (payload, token) => {
        if (payload.action === 'get-appearance') {
            await pending;
            return Response.json({ success: true, appearance });
        }
        return instance.post(payload, token);
    };
    const guest = browser({ search: '?id=' + event.id, apiPost });
    const saved = { response: { ...valid, eventId: event.id, eventType: 'events' }, eventType: 'events', organiser: invitation };
    const receipt = browser({ page: 'view', search: '?id=' + event.id, saved, apiPost });
    await Promise.all([guest.tick(), receipt.tick()]);
    const weddingRoot = element('section');
    const weddingHeading = element('h2');
    weddingHeading.setAttribute('data-copy', 'cardHeading');
    weddingRoot.appendChild(weddingHeading);
    guest.nodes.body.appendChild(weddingRoot);
    guest.themes.apply(weddingRoot, 'weddings');
    finish();
    await Promise.all([guest.themes.ready, receipt.themes.ready]);
    assert.equal(guest.nodes.heading.textContent, event.title);
    assert.equal(guest.nodes.heading.getAttribute('data-copy'), null);
    assert.equal(guest.nodes.invitationText.textContent, event.text);
    assert.equal(guest.nodes.invitationText.getAttribute('data-copy'), null);
    assert.equal(guest.nodes.eyebrow.textContent, 'Late event tagline');
    assert.equal(weddingHeading.textContent, 'Wedding only');
    assert.equal(receipt.nodes.receiptHeading.textContent, 'Late thanks');
    assert.equal(receipt.nodes.message.textContent, 'Late saved');
    const card = receipt.nodes.receipt.children[0];
    assert.equal(card.children[1].textContent, 'Late event card');
    assert.equal(card.querySelectorAll('[data-copy="nameLabel"]')[0].textContent, 'Late guest');
    assert.equal(card.style['--card-spacing'], '26px');
    assert.equal(receipt.nodes.sendOptions.children.at(-1).textContent, 'Late text');
    assert.equal(receipt.nodes.back.href, ids.invitationPath(event.id));
});

test('admin theme options match the shared card themes, including Events tokens and banner', () => {
    const html = readFileSync(`${__dirname}/admin.html`, 'utf8');
    const selector = html.match(/<select id="eventType" name="eventType">([\s\S]*?)<\/select>/)[1];
    assert.deepEqual([...selector.matchAll(/<option value="([^"]+)">/g)].map(match => match[1]),
        ['celebration', 'events', 'weddings', 'parties', 'engagements']);
    assert.match(selector, /<option value="events">Events · versatile celebration<\/option>/);
    const css = readFileSync(`${__dirname}/card.css`, 'utf8');
    const tokens = css.match(/\[data-event-type="events"\] \{([^}]+)\}/)[1];
    for (const token of ['accent', 'accent-hover', 'ink', 'paper', 'border']) {
        assert.ok(tokens.includes(`--${token}:`));
    }
    assert.match(tokens, /--banner:/);
    assert.match(tokens, /--symbol: "✧"/);
});

test('direct admin links preselect the theme, which is saved and restored when loading invitations', async () => {
    for (const eventType of ['events', 'weddings', 'parties', 'engagements']) {
        const app = browser({ page: 'admin', search: '?type=' + eventType });
        assert.equal(app.nodes['editor-eventType'].value, eventType);
        assert.equal(app.nodes.body.attributes['data-event-type'], eventType);
        await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
        await app.nodes.invitationForm.handlers.submit({ preventDefault() {} });
        assert.equal(app.requests.at(-1).eventType, eventType);
        assert.equal(app.nodes.shareInvitation.children[1].href, 'https://example.com' + ids.invitationPath(app.event.id));
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
    assert.equal(receipt.nodes.back.href, ids.invitationPath(id));
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
        assert.equal(view.nodes.receiptHeading.textContent, appearanceModel.defaultCopy(expected).receiptHeading);
        assert.equal(view.nodes.back.href, ids.invitationPath(app.event.id));
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

test('legacy email invitations stay readable but email is redacted and preserved on save', async () => {
    const instance = api();
    const event = await createEvent(instance);
    delete event.sms;
    event.email = 'legacy@example.com';
    instance.records.set('rsvp-invitation:' + event.id, JSON.stringify(event));
    const loaded = await (await instance.post({ action: 'get-invitation', id: event.id })).json();
    assert.equal(loaded.invitation.email, undefined);
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
    assert.equal(view.nodes.back.href, ids.invitationPath(event.id));
});

test('event panel recalls codes and links, opens editor, scopes replies and clears on logout', async () => {
    const app = browser({ page: 'admin' });
    await app.nodes.loginForm.handlers.submit({ preventDefault() {} });
    assert.equal(app.nodes.eventsPanel.hidden, false);
    const row = app.nodes.events.children[0];
    assert.equal(row.children[0].textContent, app.event.title);
    assert.match(row.children[1].textContent, /Replies: 0/);
    assert.equal(row.children[2].textContent, 'Invite code: ' + ids.invitationShortId(app.event.id));
    assert.equal(row.children[3].href, 'https://example.com' + ids.invitationPath(app.event.id));
    await row.children[4].click();
    await row.children[5].click();
    await app.tick();
    assert.deepEqual(app.copied, [ids.invitationShortId(app.event.id), row.children[3].href]);
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

// Distinct, readable palettes per category, including the editable button colours.
const palettes = {
    celebration: { surface: '#2b1d22', textColor: '#fbeff2', headingColor: '#ffd6e0',
        buttonBackground: '#ffd6e0', buttonText: '#2b1d22', buttonBorder: '#ffd6e0' },
    events: { surface: '#14101f', textColor: '#f5e9ff', headingColor: '#ffb347',
        buttonBackground: '#ff7518', buttonText: '#14101f', buttonBorder: '#ffb347' },
    weddings: { surface: '#f7fbf4', textColor: '#1f3324', headingColor: '#2c4a33',
        buttonBackground: '#2c4a33', buttonText: '#f7fbf4', buttonBorder: '#5b7a61' },
    parties: { surface: '#fff4fb', textColor: '#3a1450', headingColor: '#6a1b9a',
        buttonBackground: '#ffe066', buttonText: '#3a1450', buttonBorder: '#6a1b9a' },
    engagements: { surface: '#fffaf0', textColor: '#4a2c20', headingColor: '#7a3e1d',
        buttonBackground: '#7a3e1d', buttonText: '#fffaf0', buttonBorder: '#a0522d' }
};
const colorKeys = ['surface', 'textColor', 'headingColor', 'buttonBackground', 'buttonText', 'buttonBorder'];

async function signIn(admin) {
    await admin.nodes.loginForm.handlers.submit({ preventDefault() {} });
    await admin.tick();
}

function chooseCategory(admin, type) {
    admin.nodes['editor-eventType'].value = type;
    admin.nodes['editor-eventType'].handlers.change();
}

function editStyles(admin, styles) {
    for (const [key, value] of Object.entries(styles)) admin.nodes.appearanceForm.elements['style-' + key].value = value;
    admin.nodes.appearanceForm.handlers.input();
}

function shownColors(admin) {
    return Object.fromEntries(colorKeys.map(key => [key, admin.nodes.appearanceForm.elements['style-' + key].value]));
}

function buttonTokens(node) {
    return { buttonBackground: node.style['--btn-bg'], buttonText: node.style['--btn-text'], buttonBorder: node.style['--btn-border'] };
}

test('test palettes are valid, readable and keep derived hover states readable', () => {
    for (const type of categories) {
        const style = { ...appearanceModel.defaultCardStyle(type), ...palettes[type] };
        assert.deepEqual(plain(appearanceModel.contrastIssues(style)), [], type);
        const hover = appearanceModel.buttonHover(style);
        assert.notEqual(hover, style.buttonBackground, type + ' hover must be visibly different');
        assert.ok(contrastRatio(style.buttonText, hover) >= 4.5, type + ' hover label contrast');
    }
});

test('exact chosen card and button colours survive save, fresh public read, admin reload, category switches and re-apply in all five categories', async () => {
    const instance = api();
    const admin = browser({ page: 'admin', search: '?type=celebration', apiPost: instance.post });
    await signIn(admin);
    for (const type of categories) {
        chooseCategory(admin, type);
        editStyles(admin, palettes[type]);
        assert.equal(admin.nodes.appearanceStatus.getAttribute('data-state'), 'draft');
        assert.match(admin.nodes.appearanceStatus.textContent, /Unsaved preview .*not published/);
        await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
        assert.equal(admin.nodes.appearanceStatus.getAttribute('data-state'), 'success', type);
        assert.match(admin.nodes.appearanceStatus.textContent, /^Saved and published for /);
        assert.deepEqual(shownColors(admin), palettes[type], type + ' inputs keep exact colours after Save');
        assert.deepEqual(buttonTokens(admin.nodes.body), {
            buttonBackground: palettes[type].buttonBackground, buttonText: palettes[type].buttonText,
            buttonBorder: palettes[type].buttonBorder
        });
    }
    for (const type of categories) {
        chooseCategory(admin, type);
        assert.deepEqual(shownColors(admin), palettes[type], type + ' after switching categories');
        assert.equal(admin.nodes.appearancePreview.style['--btn-bg'], palettes[type].buttonBackground);
        assert.equal(admin.nodes.appearancePreview.style['--card-surface'], palettes[type].surface);
    }
    const fresh = (await (await instance.post({ action: 'get-appearance' })).json()).appearance;
    for (const type of categories) {
        for (const key of colorKeys) assert.equal(fresh[type].cardStyle[key], palettes[type][key], type + ' ' + key);
    }
    const reloaded = browser({ page: 'admin', search: '?type=events', apiPost: instance.post });
    await signIn(reloaded);
    for (const type of categories) {
        chooseCategory(reloaded, type);
        assert.deepEqual(shownColors(reloaded), palettes[type], type + ' after reload');
        await reloaded.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
        assert.equal(reloaded.nodes.appearanceStatus.getAttribute('data-state'), 'success');
        assert.deepEqual(shownColors(reloaded), palettes[type], type + ' after applying again');
    }
});

test('save response is authoritative when KV reads lag a write, and a reload prefers this browser’s newer saved revision', async () => {
    const instance = api();
    const read = instance.env.FORM_SUBMISSIONS.get;
    let lagging = true;
    // Simulate an edge cache still holding the pre-save (missing) value.
    instance.env.FORM_SUBMISSIONS.get = async key => lagging && key.startsWith('rsvp-appearance:') ? undefined : read(key);
    const local = new Map();
    const admin = browser({ page: 'admin', search: '?type=events', apiPost: instance.post, localStore: local });
    await signIn(admin);
    editStyles(admin, palettes.events);
    await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
    assert.equal(admin.nodes.appearanceStatus.getAttribute('data-state'), 'success');
    assert.deepEqual(shownColors(admin), palettes.events, 'Inputs must not revert to the stale read');
    assert.equal(admin.themes.settings('events').cardStyle.buttonBackground, palettes.events.buttonBackground);
    assert.ok(JSON.parse(local.get('rsvp_appearance_saved')).events.updatedAt > 0);

    const reloaded = browser({ page: 'admin', search: '?type=events', apiPost: instance.post, localStore: local });
    await signIn(reloaded);
    assert.deepEqual(shownColors(reloaded), palettes.events, 'Reload keeps the newer saved revision over a stale edge read');
    const landing = browser({ page: 'landing', eventType: 'events', search: '', apiPost: instance.post, localStore: local });
    await landing.tick();
    assert.equal(landing.nodes.body.style['--btn-bg'], palettes.events.buttonBackground);
    assert.equal(landing.nodes.body.style['--category-image'], 'url("' + halloween + '")', 'Events background is preserved');

    lagging = false;
    const caughtUp = browser({ page: 'landing', eventType: 'events', search: '', apiPost: instance.post, localStore: local });
    await caughtUp.tick();
    assert.equal(caughtUp.nodes.body.style['--btn-bg'], palettes.events.buttonBackground);
    assert.equal(Object.hasOwn(JSON.parse(local.get('rsvp_appearance_saved')), 'events'), false, 'Local copy is pruned once the server catches up');

    // An older local revision never overrides newer server settings saved elsewhere.
    local.set('rsvp_appearance_saved', JSON.stringify({ events: { ...appearanceModel.normalizeAppearance('events', {}), updatedAt: 1 } }));
    const other = browser({ page: 'landing', eventType: 'events', search: '', apiPost: instance.post, localStore: local });
    await other.tick();
    assert.equal(other.nodes.body.style['--btn-bg'], palettes.events.buttonBackground);
});

test('invalid colour combinations show exact preview values with inline actionable errors, keep input and never report success', async () => {
    const instance = api();
    const admin = browser({ page: 'admin', search: '?type=weddings', apiPost: instance.post });
    await signIn(admin);
    const fields = admin.nodes.appearanceForm.elements;
    const errorFor = key => admin.nodes.styleEditor.children.find(node => node.id === 'style-' + key + '-error');
    editStyles(admin, { surface: '#ffffff', textColor: '#eeeeee', buttonBackground: '#123456', buttonText: '#123456', buttonBorder: '#fafafa' });
    assert.equal(admin.nodes.appearancePreview.style['--card-text'], '#eeeeee', 'Preview shows the exact chosen colour');
    for (const key of ['textColor', 'buttonText', 'buttonBorder']) {
        assert.equal(fields['style-' + key].getAttribute('aria-invalid'), 'true', key);
        assert.equal(fields['style-' + key].getAttribute('aria-describedby'), 'style-' + key + '-error');
        assert.match(errorFor(key).textContent, /needs at least (4\.5|3):1\. Choose a (darker|lighter) /, key);
    }
    assert.equal(fields['style-headingColor'].getAttribute('aria-invalid'), null);
    assert.equal(errorFor('headingColor').textContent, '');
    const requests = admin.requests.length;
    await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
    assert.equal(admin.requests.slice(requests).some(item => item.action === 'save-appearance'), false);
    assert.equal(admin.nodes.appearanceStatus.getAttribute('data-state'), 'error');
    assert.match(admin.nodes.appearanceStatus.textContent, /^Not saved\. Text colour #eeeeee .* still here\.$/);
    assert.equal(fields['style-textColor'].value, '#eeeeee', 'Unsaved input is kept');
    assert.equal(instance.records.has('rsvp-appearance:weddings'), false);

    // Fixing the colours clears the inline errors and saves.
    editStyles(admin, palettes.weddings);
    assert.equal(fields['style-textColor'].getAttribute('aria-invalid'), null);
    assert.equal(errorFor('textColor').textContent, '');
    await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
    assert.equal(admin.nodes.appearanceStatus.getAttribute('data-state'), 'success');

    // The server enforces the same rules and explains each failing pair.
    for (const [cardStyle, field, minimum] of [
        [{ buttonBackground: '#777777', buttonText: '#888888' }, 'buttonText', 4.5],
        [{ surface: '#ffffff', buttonBorder: '#eeeeee' }, 'buttonBorder', 3],
        [{ surface: '#000000', textColor: '#ffffff', headingColor: '#ffffff', buttonBorder: '#111111' }, 'buttonBorder', 3]
    ]) {
        const response = await instance.post({ action: 'save-appearance', eventType: 'parties', backgroundImage: '', cardStyle }, 'valid-session');
        assert.equal(response.status, 400);
        const data = await response.json();
        assert.equal(data.fields[0].field, field);
        assert.equal(data.fields[0].minimum, minimum);
        assert.match(data.error, /^Not saved: /);
    }
    assert.equal(instance.records.has('rsvp-appearance:parties'), false);
});

test('a save the server does not confirm exactly is reported as not saved and keeps the draft', async () => {
    const instance = api();
    const admin = browser({ page: 'admin', search: '?type=parties', apiPost: async (payload, token) => {
        if (payload.action !== 'save-appearance') return instance.post(payload, token);
        // A misbehaving or stale server response that silently substituted a colour.
        const appearance = (await (await instance.post({ action: 'get-appearance' })).json()).appearance;
        return Response.json({ success: true, appearance });
    } });
    await signIn(admin);
    editStyles(admin, palettes.parties);
    await admin.nodes.appearanceForm.handlers.submit({ preventDefault() {} });
    assert.equal(admin.nodes.appearanceStatus.getAttribute('data-state'), 'error');
    assert.match(admin.nodes.appearanceStatus.textContent, /did not confirm your exact settings/);
    assert.doesNotMatch(admin.nodes.appearanceStatus.textContent, /Saved and published/);
    assert.deepEqual(shownColors(admin), palettes.parties);
});

test('late appearance loading and category switches never overwrite unsaved colour edits', async () => {
    const instance = api();
    await instance.post({ action: 'save-appearance', eventType: 'engagements', backgroundImage: '', cardStyle: palettes.engagements }, 'valid-session');
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const admin = browser({ page: 'admin', search: '?type=engagements', apiPost: async (payload, token) => {
        if (payload.action === 'get-appearance') await pending;
        return instance.post(payload, token);
    } });
    await signIn(admin);
    const edit = { surface: '#ffffff', textColor: '#000000', headingColor: '#000000', buttonBackground: '#000000', buttonText: '#ffffff', buttonBorder: '#000000' };
    editStyles(admin, edit);
    finish();
    await admin.tick();
    await admin.tick();
    assert.equal(admin.themes.settings('engagements').cardStyle.surface, palettes.engagements.surface, 'Saved settings did load');
    assert.deepEqual(shownColors(admin), edit, 'Late read must not overwrite unsaved edits');
    assert.equal(admin.nodes.appearancePreview.style['--card-surface'], '#ffffff');
    assert.equal(admin.nodes.appearanceStatus.getAttribute('data-state'), 'draft');
    chooseCategory(admin, 'weddings');
    assert.equal(shownColors(admin).surface, appearanceModel.defaultCardStyle('weddings').surface);
    chooseCategory(admin, 'engagements');
    assert.deepEqual(shownColors(admin), edit, 'Unsaved draft is restored when switching back');
    assert.match(admin.nodes.appearanceStatus.textContent, /Unsaved preview for Engagements/);
    assert.equal(JSON.parse(instance.records.get('rsvp-appearance:engagements')).cardStyle.surface, palettes.engagements.surface);
    admin.nodes.logout.handlers.click();
    await signIn(admin);
    chooseCategory(admin, 'engagements');
    assert.deepEqual(shownColors(admin), palettes.engagements, 'Signing out discards unsaved drafts');
});

test('older settings without button colours keep the original accent buttons and derive readable buttons for dark cards', async () => {
    const css = readFileSync(`${__dirname}/card.css`, 'utf8');
    for (const type of categories) {
        const block = type === 'celebration' ? css.match(/:root, \[data-event-type\] \{([^}]*)\}/)[1] :
            css.match(new RegExp('\\[data-event-type="' + type + '"\\] \\{([^}]*)\\}'))[1];
        const accent = block.match(/--accent: (#[0-9a-f]{6})/)[1];
        const defaults = appearanceModel.defaultCardStyle(type);
        assert.equal(defaults.buttonBackground, accent, type);
        assert.equal(defaults.buttonBorder, accent, type);
        assert.equal(defaults.buttonText, '#ffffff', type);
    }
    const instance = api();
    instance.records.set('rsvp-appearance:events', JSON.stringify({
        backgroundImage: halloween, copy: { brand: 'Legacy brand' },
        cardStyle: { surface: '#14101f', textColor: '#ffffff', headingColor: '#ffffff', spacing: 20 }
    }));
    instance.records.set('rsvp-appearance:weddings', JSON.stringify({ backgroundImage: '' }));
    const settings = (await (await instance.post({ action: 'get-appearance' })).json()).appearance;
    assert.equal(settings.events.backgroundImage, halloween);
    assert.equal(settings.events.copy.brand, 'Legacy brand');
    assert.equal(settings.events.cardStyle.surface, '#14101f');
    assert.equal(settings.events.updatedAt, 0);
    assert.deepEqual(plain(appearanceModel.contrastIssues(settings.events.cardStyle)), []);
    assert.deepEqual(settings.weddings.cardStyle, plain(appearanceModel.defaultCardStyle('weddings')));
    // Older clients that send only card colours still save; buttons stay readable.
    const response = await instance.post({ action: 'save-appearance', eventType: 'parties', backgroundImage: '',
        cardStyle: { surface: '#000000', textColor: '#ffffff', headingColor: '#ffffff' } }, 'valid-session');
    assert.equal(response.status, 200);
    const parties = (await response.json()).appearance.parties.cardStyle;
    assert.equal(parties.surface, '#000000');
    assert.deepEqual(plain(appearanceModel.contrastIssues(parties)), []);
    // Unknown or server-owned keys cannot be written by clients.
    assert.equal((await instance.post({ action: 'save-appearance', eventType: 'parties', backgroundImage: '', updatedAt: 1e15 }, 'valid-session')).status, 400);
});

test('saved button colours reach the open RSVP CTA, form, receipt, send options and mixed reply cards without leaking across categories', async () => {
    const instance = api();
    for (const type of categories) {
        assert.equal((await instance.post({ action: 'save-appearance', eventType: type,
            backgroundImage: type === 'events' ? halloween : '', cardStyle: palettes[type] }, 'valid-session')).status, 200);
    }
    const events = {};
    for (const type of categories) {
        events[type] = await createEvent(instance, { eventType: type, title: 'Same title' });
        const original = instance.records.get('rsvp-invitation:' + events[type].id);
        const guest = browser({ search: '?id=' + events[type].id, apiPost: instance.post });
        await guest.tick();
        const palette = palettes[type];
        assert.equal(guest.nodes.openRsvp.attributes.class, 'rsvp-btn primary');
        assert.equal(guest.nodes.openRsvp.closest('[data-event-type]'), guest.nodes.body);
        assert.deepEqual(buttonTokens(guest.nodes.body), { buttonBackground: palette.buttonBackground,
            buttonText: palette.buttonText, buttonBorder: palette.buttonBorder }, type);
        assert.equal(guest.nodes.body.style['--btn-hover-bg'], appearanceModel.buttonHover({ ...palette }));
        assert.equal(guest.nodes.body.style['--card-surface'], palette.surface);
        guest.nodes.openRsvp.handlers.click();
        guest.nodes.name.value = 'Guest';
        guest.nodes.attending.value = 'yes';
        guest.nodes.guests.value = '0';
        await guest.nodes.rsvpForm.handlers.submit({ preventDefault() {} });
        const saved = JSON.parse(guest.stored.get('rsvp_receipt'));
        const receipt = browser({ page: 'view', search: '?' + guest.redirects[0].split('?')[1], saved, apiPost: instance.post });
        await receipt.tick();
        for (const node of [receipt.nodes.body, receipt.nodes.receipt.children[0], receipt.nodes.sendOptions]) {
            assert.equal(node.attributes['data-event-type'], type);
            assert.deepEqual(buttonTokens(node), { buttonBackground: palette.buttonBackground,
                buttonText: palette.buttonText, buttonBorder: palette.buttonBorder }, type + ' receipt');
        }
        assert.equal(instance.records.get('rsvp-invitation:' + events[type].id), original, 'Invitations are never re-saved');
    }
    const admin = browser({ page: 'admin', search: '?type=parties', apiPost: instance.post });
    await signIn(admin);
    const cards = admin.nodes.responses.children;
    assert.equal(cards.length, categories.length);
    for (const card of cards) {
        const type = card.attributes['data-event-type'];
        assert.equal(card.style['--btn-bg'], palettes[type].buttonBackground, type + ' reply card');
        assert.equal(card.style['--card-surface'], palettes[type].surface, type + ' reply card');
        assert.equal(card.querySelector('button').closest('[data-event-type]'), card);
    }
    assert.deepEqual(new Set(cards.map(card => card.attributes['data-event-type'])), new Set(categories));
    assert.equal(admin.nodes.body.style['--btn-bg'], palettes.parties.buttonBackground);
});

test('RSVP controls, fields and headings consume shared tokens instead of fixed colours', () => {
    const css = readFileSync(`${__dirname}/card.css`, 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
        selectors: selectors.split(',').map(value => value.replace(/\/\*[\s\S]*?\*\//g, '').trim()), body
    }));
    const rule = selector => rules.find(item => item.selectors.includes(selector));
    for (const [selector, tokens] of [
        ['.rsvp-btn', ['--card-text', '--card-surface', '--btn-border']],
        ['.rsvp-btn.primary', ['--btn-bg', '--btn-text', '--btn-border']],
        ['.rsvp-btn.primary:hover:not(:disabled)', ['--btn-hover-bg', '--btn-text']],
        ['.rsvp-btn:hover:not(:disabled)', ['--btn-bg', '--btn-text']],
        ['input', ['--card-text', '--card-surface', '--btn-border']],
        ['.page-head h1', ['--card-heading']],
        ['.landing-copy h1', ['--card-heading']]
    ]) {
        const found = rule(selector);
        assert.ok(found, selector);
        for (const token of tokens) assert.ok(found.body.includes('var(' + token), selector + ' uses ' + token);
        assert.doesNotMatch(found.body, /(?:^|;)\s*(?:color|background|border(?:-color)?)\s*:\s*#/, selector + ' has no fixed colour');
    }
    assert.doesNotMatch(css, /^\.primary\s*[{:]/m, 'No unscoped fixed-accent .primary rule remains');
    assert.match(rule('.rsvp-btn:disabled').body, /cursor: not-allowed/);
    assert.match(rule(':focus-visible').body, /outline: 3px solid/);
    const admin = readFileSync(`${__dirname}/admin.html`, 'utf8');
    assert.match(admin, /<span class="rsvp-btn primary" data-copy="openRsvp">/, 'Preview CTA matches the public primary button');
    assert.match(admin, /id="appearanceStatus"[^>]*role="status"/);
    assert.match(readFileSync(`${__dirname}/index.html`, 'utf8'), /id="openRsvp" data-copy="openRsvp" class="rsvp-btn primary"/);
});
