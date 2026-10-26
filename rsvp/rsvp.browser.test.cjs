// Real-browser checks for RSVP theming. Payload tests cannot see CSS specificity or hardcoded
// colours, so these load the actual pages in headless Chromium and compare computed styles.
// Run: node --test rsvp/rsvp.browser.test.cjs (set CHROME_PATH if Chromium is elsewhere).
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { readFileSync, existsSync, mkdtempSync, rmSync } = require('node:fs');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(file => file && existsSync(file));
const skip = chrome && typeof WebSocket === 'function' ? false : 'Chromium (or CHROME_PATH) and Node 22+ WebSocket are required';

const themesSource = readFileSync(`${__dirname}/themes.js`, 'utf8').replace(/^export /gm, '');
const model = runInNewContext(themesSource + '\n({ buttonHover, contrastIssues, defaultCardStyle })', { URL });
const apiSource = themesSource + '\n' + readFileSync(`${root}/functions/api/rsvp.js`, 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');
const categories = ['celebration', 'events', 'weddings', 'parties', 'engagements'];
const halloween = 'https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/ween.jpg';
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
const rgb = hex => 'rgb(' + hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ') + ')';

let records, server, origin, chromeProcess, profile, socket, page, closeBrowser;
const events = {};
const holds = {};
const protocolHandlers = new Map();

function hold(key) {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    holds[key] = promise;
    return () => { delete holds[key]; release(); };
}

function api(body, token) {
    const context = {
        URL, Response, crypto: webcrypto,
        validateSession: async (_, value) => value === 'valid-session' ? { userId: '__admin__' } : null
    };
    runInNewContext(apiSource, context);
    return context.onRequestPost({
        env: { FORM_SUBMISSIONS: {
            put: async (key, value) => records.set(key, value),
            get: async key => records.get(key),
            delete: async key => records.delete(key),
            list: async ({ prefix, limit, cursor }) => {
                const keys = [...records.keys()].filter(key => key.startsWith(prefix));
                const offset = Number(cursor) || 0;
                return { keys: keys.slice(offset, offset + limit).map(name => ({ name })),
                    list_complete: offset + limit >= keys.length, cursor: String(offset + limit) };
            }
        } },
        request: new Request('https://example.com/api/rsvp', { method: 'POST', body,
            headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Session': token } : {}) } })
    });
}

async function startServer() {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
    server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (request.method === 'POST') {
            let body = '';
            for await (const chunk of request) body += chunk;
            const action = JSON.parse(body).action;
            if (holds[action]) await holds[action];
            const result = url.pathname === '/api/password' ? Response.json({ success: true, sessionToken: 'valid-session' }) :
                url.pathname === '/api/rsvp' ? await api(body, request.headers['x-admin-session']) : new Response('', { status: 404 });
            response.writeHead(result.status, { 'Content-Type': 'application/json' });
            return response.end(await result.text());
        }
        if (url.pathname === '/rsvp/theme-client.js' && holds.module) await holds.module;
        let file = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
        if (!path.extname(file)) file += '.html';
        const full = path.join(root, path.normalize(file));
        if (!full.startsWith(path.join(root, 'rsvp') + path.sep) || !existsSync(full)) {
            response.writeHead(404);
            return response.end();
        }
        response.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
        response.end(readFileSync(full));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + server.address().port;
}

async function startChrome() {
    profile = mkdtempSync(path.join(os.tmpdir(), 'rsvp-chrome-'));
    chromeProcess = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Chromium did not start: ' + output)), 20000);
        chromeProcess.stderr.on('data', chunk => {
            output += chunk;
            const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
        chromeProcess.on('exit', () => { clearTimeout(timer); reject(new Error('Chromium exited: ' + output)); });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let next = 0;
    const pending = new Map();
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method) {
            const handler = protocolHandlers.get(message.method);
            if (handler) handler(message.params);
            return;
        }
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    page = (method, params) => send(method, params, sessionId);
    closeBrowser = () => send('Browser.close').catch(() => {});
    await page('Page.enable');
    await page('Page.bringToFront');
    await page('Network.enable');
    // Keep the run offline and deterministic; the image URL itself is asserted as a CSS value.
    await page('Network.setBlockedURLs', { urls: ['*r2.dev*'] });
    await page('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.__backgroundFrames = [];
        function sampleBackground() {
            if (document.body && window.__backgroundFrames.length < 1000) {
                const banner = document.querySelector('.rsvp-banner');
                window.__backgroundFrames.push({
                    body: getComputedStyle(document.body).backgroundImage,
                    banner: banner ? getComputedStyle(banner).backgroundImage : 'none',
                    type: document.body.dataset.eventType,
                    state: document.body.className
                });
            }
            requestAnimationFrame(sampleBackground);
        }
        requestAnimationFrame(sampleBackground);
    ` });
}

async function evaluate(body) {
    const result = await page('Runtime.evaluate', { expression: '(async () => {' + body + '})()', awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
}

async function waitFor(condition, label) {
    for (let attempt = 0; attempt < 400; attempt++) {
        if (await evaluate('return !!(' + condition + ');').catch(() => false)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for ' + (label || condition));
}

async function open(url) {
    await navigate(url);
    await waitFor('document.readyState === "complete" && window.RSVPThemes', url);
    await evaluate('await window.RSVPThemes.ready; return true;');
}

async function navigate(url) {
    await evaluate('window.__previous = true; return true;');
    await page('Page.navigate', { url: origin + url });
    await waitFor('!window.__previous && document.body', url);
}

function styles(selector, properties = ['backgroundColor', 'color', 'borderTopColor']) {
    return evaluate('const node = document.querySelector(' + JSON.stringify(selector) + ');' +
        'if (!node) throw new Error(' + JSON.stringify('Missing ' + selector) + ');' +
        'const style = getComputedStyle(node); return Object.fromEntries(' + JSON.stringify(properties) +
        '.map(key => [key, style[key]]));');
}

async function signIn(type) {
    await open('/rsvp/admin?type=' + type);
    await evaluate('document.getElementById("password").value = "local-fixture"; document.getElementById("loginForm").requestSubmit(); return true;');
    await waitFor('!document.getElementById("appearanceForm").hidden && document.getElementById("message").textContent !== "Signing in…"', 'admin sign in');
}

async function chooseCategory(type) {
    await evaluate('const select = document.getElementById("eventType"); select.value = ' + JSON.stringify(type) +
        '; select.dispatchEvent(new Event("change", { bubbles: true })); return true;');
}

async function editColors(colors) {
    await evaluate('for (const [key, value] of Object.entries(' + JSON.stringify(colors) + ')) {' +
        'const input = document.getElementById("style-" + key); input.value = value;' +
        'input.dispatchEvent(new Event("input", { bubbles: true })); } return true;');
}

async function saveAppearance() {
    await evaluate('document.getElementById("appearanceStatus").removeAttribute("data-state");' +
        'document.getElementById("appearanceForm").requestSubmit(); return true;');
    await waitFor('["success", "error"].includes(document.getElementById("appearanceStatus").dataset.state)', 'save feedback');
    return evaluate('const node = document.getElementById("appearanceStatus"); return { state: node.dataset.state, text: node.textContent };');
}

function shownColors() {
    return evaluate('return Object.fromEntries(' + JSON.stringify(Object.keys(palettes.events)) +
        '.map(key => [key, document.getElementById("style-" + key).value]));');
}

before(async () => {
    if (skip) return;
    records = new Map();
    await startServer();
    await startChrome();
});

after(async () => {
    if (chromeProcess && chromeProcess.exitCode === null) {
        const exited = new Promise(resolve => chromeProcess.once('exit', resolve));
        if (closeBrowser) await closeBrowser();
        const timer = setTimeout(() => chromeProcess.kill(), 5000);
        await exited;
        clearTimeout(timer);
    }
    if (socket) socket.close();
    if (server) await new Promise(resolve => server.close(resolve));
    // Chromium helpers can briefly outlive the browser; temporary profile cleanup is best-effort.
    if (profile) try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* Left in tmp. */ }
});

test('admin Save keeps the exact colours, previews them with real CSS and they survive a page reload', { skip }, async () => {
    await signIn('celebration');
    for (const type of categories) {
        await chooseCategory(type);
        await editColors(palettes[type]);
        assert.match(await evaluate('return document.getElementById("appearanceStatus").textContent;'), /Unsaved preview/);
        const preview = await styles('#appearancePreview .rsvp-btn.primary');
        assert.deepEqual(preview, { backgroundColor: rgb(palettes[type].buttonBackground),
            color: rgb(palettes[type].buttonText), borderTopColor: rgb(palettes[type].buttonBorder) }, type + ' preview CTA');
        assert.equal((await styles('#appearancePreview .rsvp-card')).backgroundColor, rgb(palettes[type].surface));
        assert.equal((await styles('#previewInvitationTitle', ['color'])).color, rgb(palettes[type].headingColor));
        const saved = await saveAppearance();
        assert.equal(saved.state, 'success', type + ': ' + saved.text);
        assert.deepEqual(await shownColors(), palettes[type], type + ' inputs after Save');
    }
    await signIn('events');
    for (const type of categories) {
        await chooseCategory(type);
        assert.deepEqual(await shownColors(), palettes[type], type + ' inputs after reload');
    }
    assert.equal(await evaluate('return document.getElementById("backgroundImage").value;'), '');
    await chooseCategory('events');
    assert.equal(await evaluate('return document.getElementById("backgroundImage").value;'), halloween);
});

test('invalid colours are explained inline, keep the chosen value and are not saved', { skip }, async () => {
    await signIn('weddings');
    const before = records.get('rsvp-appearance:weddings');
    await editColors({ textColor: palettes.weddings.surface });
    const error = await evaluate('const input = document.getElementById("style-textColor");' +
        'const message = document.getElementById(input.getAttribute("aria-describedby"));' +
        'return { invalid: input.getAttribute("aria-invalid"), message: message.textContent, visible: getComputedStyle(message).display !== "none" };');
    assert.equal(error.invalid, 'true');
    assert.equal(error.visible, true);
    assert.match(error.message, /needs at least 4\.5:1/);
    const result = await saveAppearance();
    assert.equal(result.state, 'error');
    assert.match(result.text, /^Not saved\./);
    assert.equal((await shownColors()).textColor, palettes.weddings.surface);
    assert.equal(records.get('rsvp-appearance:weddings'), before);
});

test('invitation, open RSVP button, form fields, receipt and landing pages render saved colours in every category', { skip }, async () => {
    for (const type of categories) {
        const palette = palettes[type];
        const created = await (await api(JSON.stringify({ action: 'save-invitation', eventType: type, title: 'Same title',
            text: 'Invitation for ' + type, whatsapp: '+447700900123', sms: '+447700900124' }), 'valid-session')).json();
        events[type] = created.invitation;
        await open('/rsvp/?id=' + created.invitation.id);
        await waitFor('!document.getElementById("openRsvp").hidden', 'open RSVP button');
        assert.deepEqual(await styles('.rsvp-card', ['backgroundColor', 'color']),
            { backgroundColor: rgb(palette.surface), color: rgb(palette.textColor) }, type + ' card');
        assert.equal((await styles('#heading', ['color'])).color, rgb(palette.headingColor));
        assert.equal((await styles('#invitationText', ['color'])).color, rgb(palette.textColor));
        assert.deepEqual(await styles('#openRsvp'), { backgroundColor: rgb(palette.buttonBackground),
            color: rgb(palette.buttonText), borderTopColor: rgb(palette.buttonBorder) }, type + ' RSVP to this celebration');
        const box = await evaluate('const r = document.getElementById("openRsvp").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };');
        await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
        const hover = await styles('#openRsvp', ['backgroundColor', 'color', 'textDecorationLine']);
        assert.deepEqual(hover, { backgroundColor: rgb(model.buttonHover({ ...model.defaultCardStyle(type), ...palette })),
            color: rgb(palette.buttonText), textDecorationLine: 'underline' }, type + ' hover');
        await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
        await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await evaluate('document.getElementById("openRsvp").focus(); return true;');
        const focus = await styles('#openRsvp', ['outlineStyle', 'outlineWidth']);
        assert.deepEqual(focus, { outlineStyle: 'solid', outlineWidth: '3px' }, type + ' keyboard focus');
        await evaluate('document.getElementById("openRsvp").click(); return true;');
        assert.deepEqual(await styles('#name'), { backgroundColor: rgb(palette.surface),
            color: rgb(palette.textColor), borderTopColor: rgb(palette.buttonBorder) }, type + ' form field');
        assert.deepEqual(await styles('#rsvpForm button[type="submit"]'), { backgroundColor: rgb(palette.buttonBackground),
            color: rgb(palette.buttonText), borderTopColor: rgb(palette.buttonBorder) }, type + ' save RSVP');
        await evaluate('const form = document.getElementById("rsvpForm"); form.elements.attending.value = "no";' +
            'form.elements.attending.dispatchEvent(new Event("change")); return true;');
        assert.deepEqual(await styles('#guests', ['opacity', 'cursor']), { opacity: '0.6', cursor: 'not-allowed' });
        await evaluate('const form = document.getElementById("rsvpForm"); form.elements.name.value = "Guest " + ' + JSON.stringify(type) + ';' +
            'form.elements.attending.value = "yes"; form.elements.attending.dispatchEvent(new Event("change"));' +
            'form.requestSubmit(); return true;');
        await waitFor('location.pathname === "/rsvp/view" && document.querySelector("#receipt .rsvp-card") && document.readyState === "complete"', 'receipt');
        await evaluate('await window.RSVPThemes.ready; return true;');
        assert.deepEqual(await styles('.page-head', ['backgroundColor', 'color']),
            { backgroundColor: rgb(palette.surface), color: rgb(palette.textColor) }, type + ' receipt header');
        assert.equal((await styles('.page-head h1', ['color'])).color, rgb(palette.headingColor));
        assert.equal((await styles('#receipt .rsvp-card', ['backgroundColor'])).backgroundColor, rgb(palette.surface));
        assert.deepEqual(await styles('#sendOptions .rsvp-btn'), { backgroundColor: rgb(palette.surface),
            color: rgb(palette.textColor), borderTopColor: rgb(palette.buttonBorder) }, type + ' send button');
        await open(type === 'celebration' ? '/rsvp/' : '/rsvp/' + type + '/');
        assert.equal((await styles('.rsvp-card', ['backgroundColor'])).backgroundColor, rgb(palette.surface), type + ' landing');
        if (type !== 'celebration') {
            assert.equal((await styles('.landing-copy h1', ['color'])).color, rgb(palette.headingColor));
        }
        const image = await evaluate('return document.body.style.getPropertyValue("--category-image");');
        assert.equal(image, type === 'events' ? 'url("' + halloween + '")' : 'var(--backdrop)', type + ' background');
    }
});

test('mixed-category admin reply cards each use their own category colours', { skip }, async () => {
    await signIn('parties');
    await waitFor('document.querySelectorAll("#responses .rsvp-card").length === ' + categories.length, 'reply cards');
    const cards = await evaluate('return [...document.querySelectorAll("#responses .rsvp-card")].map(card => {' +
        'const button = getComputedStyle(card.querySelector("button")); const style = getComputedStyle(card);' +
        'return { type: card.dataset.eventType, surface: style.backgroundColor, text: style.color,' +
        'button: button.color, border: button.borderTopColor }; });');
    assert.deepEqual(new Set(cards.map(card => card.type)), new Set(categories));
    for (const card of cards) {
        const palette = palettes[card.type];
        assert.deepEqual(card, { type: card.type, surface: rgb(palette.surface), text: rgb(palette.textColor),
            button: rgb(palette.textColor), border: rgb(palette.buttonBorder) }, card.type);
    }
});

const fixtureImage = name => 'https://rsvp-images.test/' + name + '.svg';

async function imageResponse(requestId, status = 200) {
    await page('Fetch.fulfillRequest', { requestId, responseCode: status,
        responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }, { name: 'Cache-Control', value: 'no-store' }],
        body: status === 200 ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#123456" d="M0 0h8v8H0z"/></svg>').toString('base64') : '' });
}

async function images(handler = request => imageResponse(request.requestId)) {
    protocolHandlers.set('Fetch.requestPaused', handler);
    await page('Fetch.enable', { patterns: [{ urlPattern: 'https://rsvp-images.test/*' }] });
}

async function neutralSurface() {
    await waitFor('window.__backgroundFrames.length > 1', 'painted neutral surface');
    assert.deepEqual(await styles('body', ['backgroundImage', 'backgroundColor', 'visibility']),
        { backgroundImage: 'none', backgroundColor: 'rgb(245, 245, 245)', visibility: 'visible' });
    if (await evaluate('return !!document.querySelector(".rsvp-banner");')) {
        assert.equal((await styles('.rsvp-banner', ['backgroundImage'])).backgroundImage, 'none');
    }
    const frames = await evaluate('return window.__backgroundFrames;');
    assert.ok(frames.every(frame => frame.body === 'none' && frame.banner === 'none'), JSON.stringify(frames));
}

test('first paints stay neutral before modules and delayed settings, never exposing cached images in any category', { skip }, async () => {
    await images();
    for (const type of categories.filter(type => type !== 'celebration')) {
        const saved = JSON.parse(records.get('rsvp-appearance:' + type));
        records.set('rsvp-appearance:' + type, JSON.stringify({ ...saved, backgroundImage: fixtureImage(type), updatedAt: 2000000000000 }));
        await evaluate('localStorage.setItem("rsvp_appearance_saved", JSON.stringify({' + JSON.stringify(type) +
            ': { backgroundImage: ' + JSON.stringify(fixtureImage('obsolete-' + type)) + ', updatedAt: 1000000000000 }}));');
        const releaseModule = hold('module');
        const releaseSettings = hold('get-appearance');
        try {
            await navigate('/rsvp/' + type + '/');
            assert.equal(await evaluate('return !!window.RSVPThemes;'), false);
            await neutralSurface();
            releaseModule();
            await waitFor('window.RSVPThemes', 'module execution');
            if (type === 'events') await new Promise(resolve => setTimeout(resolve, 2700));
            await neutralSurface();
            releaseSettings();
            await waitFor('document.body.classList.contains("rsvp-theme-ready")', type + ' image decode');
            const frames = await evaluate('return window.__backgroundFrames;');
            assert.ok(frames.every(frame => frame.body === 'none' || frame.body.includes(fixtureImage(type))), type);
            assert.ok(frames.every(frame => !frame.body.includes('obsolete') && !frame.banner.includes('obsolete')), type);
            assert.equal((await styles('body', ['backgroundImage'])).backgroundImage, 'url("' + fixtureImage(type) + '")');
        } finally {
            releaseModule();
            releaseSettings();
        }
    }
});

test('guest and receipt backgrounds wait for the invitation category, not generic, URL or saved receipt hints', { skip }, async () => {
    for (const type of categories.filter(type => type !== 'celebration')) {
        for (const receipt of [false, true]) {
            await evaluate('sessionStorage.setItem("rsvp_receipt", JSON.stringify({eventType: "events",' +
                'response: {eventId: ' + JSON.stringify(events[type].id) + ', name: "Guest", attending: "yes", guests: 1}}));');
            const release = hold('get-invitation');
            try {
                await navigate(receipt ? '/rsvp/view?type=events&id=' + events[type].id : '/rsvp/?id=' + events[type].id);
                await waitFor('window.RSVPThemes', 'theme client');
                await evaluate('await window.RSVPThemes.ready;');
                await neutralSurface();
                release();
                await waitFor('document.body.dataset.eventType === ' + JSON.stringify(type) +
                    ' && document.body.classList.contains("rsvp-theme-ready")', 'final invitation background');
                const frames = await evaluate('return window.__backgroundFrames;');
                assert.ok(frames.every(frame => frame.body === 'none' ||
                    (frame.type === type && frame.body.includes(fixtureImage(type)))), type + (receipt ? ' receipt' : ' invitation'));
            } finally { release(); }
        }
    }
});

test('cold images, image failures and category switches cannot reveal a previous background', { skip }, async () => {
    const pending = [];
    await images(request => { pending.push(request); });
    await navigate('/rsvp/weddings/');
    await waitFor('window.RSVPThemes && document.body.style.getPropertyValue("--category-image").includes("weddings.svg")', 'cold image');
    await neutralSurface();
    await evaluate('window.RSVPThemes.apply(document.body, "parties");');
    await waitFor('document.body.dataset.eventType === "parties"', 'category switch');
    const weddings = pending.filter(item => item.request.url === fixtureImage('weddings'));
    assert.ok(weddings.length);
    await Promise.all(weddings.map(item => imageResponse(item.requestId)));
    await neutralSurface();
    await waitFor('window.RSVPThemes && document.body.style.getPropertyValue("--category-image").includes("parties.svg")', 'next image');
    await new Promise(resolve => setTimeout(resolve, 100));
    const parties = pending.filter(item => item.request.url === fixtureImage('parties'));
    assert.ok(parties.length);
    await Promise.all(parties.map(item => imageResponse(item.requestId)));
    await waitFor('document.body.classList.contains("rsvp-theme-ready")', 'current category image');
    assert.equal((await styles('body', ['backgroundImage'])).backgroundImage, 'url("' + fixtureImage('parties') + '")');
    await evaluate('window.RSVPThemes.apply(document.body, "engagements");');
    await waitFor('document.body.classList.contains("rsvp-theme-loading")', 'failed image loading');
    await new Promise(resolve => setTimeout(resolve, 100));
    const engagements = pending.filter(item => item.request.url === fixtureImage('engagements'));
    assert.ok(engagements.length);
    await Promise.all(engagements.map(item => imageResponse(item.requestId, 404)));
    await waitFor('document.body.classList.contains("rsvp-theme-neutral")', 'image failure fallback');
    assert.equal((await styles('body', ['backgroundImage'])).backgroundImage, 'none');
    assert.equal((await styles('.landing-nav a', ['visibility'])).visibility, 'visible');
    await images();
});

test('late invitation lookup success reveals only its final category; timeout and lookup failure stay neutral', { skip }, async () => {
    for (const receipt of [false, true]) {
        const event = events.parties;
        const url = receipt ? '/rsvp/view?type=events&id=' + event.id : '/rsvp/?id=' + event.id;
        const release = hold('get-invitation');
        try {
            await navigate(url);
            await waitFor('document.body.classList.contains("rsvp-theme-neutral")', 'category timeout');
            await neutralSurface();
            release();
            await waitFor('document.body.dataset.eventType === "parties" && document.body.classList.contains("rsvp-theme-ready")', 'late final category');
            const frames = await evaluate('return window.__backgroundFrames;');
            assert.ok(frames.every(frame => frame.body === 'none' || frame.body.includes(fixtureImage('parties'))));
        } finally { release(); }
        const stored = records.get('rsvp-invitation:' + event.id);
        records.delete('rsvp-invitation:' + event.id);
        try {
            await navigate(url);
            await waitFor('document.body.classList.contains("rsvp-theme-neutral")', 'unavailable invitation fallback');
            await neutralSurface();
        } finally { records.set('rsvp-invitation:' + event.id, stored); }
    }
});

test('stalled or failed settings and stalled images keep usable neutral surfaces rather than reveal stale defaults', { skip }, async () => {
    const release = hold('get-appearance');
    try {
        await navigate('/rsvp/events/');
        await waitFor('document.body.classList.contains("rsvp-theme-neutral")', 'bounded settings failure');
        await neutralSurface();
        release();
        await new Promise(resolve => setTimeout(resolve, 100));
        await neutralSurface();
        assert.equal(await evaluate('return await window.RSVPThemes.ready;'), false);
    } finally { release(); }
    await page('Network.setBlockedURLs', { urls: ['*r2.dev*', origin + '/api/rsvp'] });
    await navigate('/rsvp/events/');
    await waitFor('document.body.classList.contains("rsvp-theme-neutral")', 'offline settings fallback');
    await neutralSurface();
    await page('Network.setBlockedURLs', { urls: ['*r2.dev*'] });
    const pending = [];
    await images(request => { pending.push(request); });
    await navigate('/rsvp/weddings/');
    await waitFor('document.body.classList.contains("rsvp-theme-neutral")', 'bounded image failure');
    await neutralSurface();
    await Promise.all(pending.map(item => imageResponse(item.requestId).catch(error => {
        // Timed-out image requests may already have been cancelled by the client.
        assert.match(error.message, /Invalid InterceptionId/);
    })));
    await new Promise(resolve => setTimeout(resolve, 100));
    await neutralSurface();
    await images();
});

test('admin draft previews wait for decoding and ignore obsolete image completions', { skip }, async () => {
    await signIn('weddings');
    await evaluate('const decode = Image.prototype.decode; Image.prototype.decode = function () {' +
        'const decoded = decode.call(this); return this.src.includes("decode-slow") ?' +
        'decoded.then(() => new Promise(resolve => { window.__finishDecode = resolve; })) : decoded; };' +
        'const input = document.getElementById("backgroundImage"); input.value = ' + JSON.stringify(fixtureImage('decode-slow')) +
        '; input.dispatchEvent(new Event("input", {bubbles: true}));');
    await waitFor('window.__finishDecode', 'decoded preview bytes');
    assert.equal((await styles('#appearancePreview', ['backgroundImage'])).backgroundImage, 'none');
    assert.equal((await styles('#appearancePreview .rsvp-banner', ['backgroundImage'])).backgroundImage, 'none');
    await chooseCategory('parties');
    await waitFor('document.getElementById("appearancePreview").classList.contains("rsvp-theme-ready")', 'new category preview');
    await evaluate('window.__finishDecode();');
    assert.equal((await styles('#appearancePreview', ['backgroundImage'])).backgroundImage, 'url("' + fixtureImage('parties') + '")');
    await evaluate('window.__finishDecode = null;');
    await chooseCategory('weddings');
    await waitFor('document.getElementById("appearancePreview").classList.contains("rsvp-theme-loading")', 'preserved unsaved draft');
    await waitFor('window.__finishDecode', 'draft decoding');
    await evaluate('window.__finishDecode();');
    await waitFor('document.getElementById("appearancePreview").classList.contains("rsvp-theme-ready")', 'decoded draft');
    assert.equal((await styles('#appearancePreview', ['backgroundImage'])).backgroundImage, 'url("' + fixtureImage('decode-slow') + '")');
    await page('Network.setBlockedURLs', { urls: ['*r2.dev*', origin + '/api/rsvp'] });
    try {
        await evaluate('await window.RSVPThemes.load();');
        assert.equal((await styles('body', ['backgroundImage'])).backgroundImage, 'none');
        assert.equal((await styles('#appearancePreview .rsvp-banner', ['backgroundImage'])).backgroundImage,
            'url("' + fixtureImage('decode-slow') + '")', 'ready preview is independent of a failed page background');
    } finally { await page('Network.setBlockedURLs', { urls: ['*r2.dev*'] }); }
});

test('missing modules and disabled JavaScript leave content and navigation visible on a neutral background', { skip }, async () => {
    await page('Network.setBlockedURLs', { urls: ['*r2.dev*', origin + '/rsvp/theme-client.js'] });
    await navigate('/rsvp/events/');
    await waitFor('document.readyState === "complete"', 'failed module request');
    assert.equal(await evaluate('return !!window.RSVPThemes;'), false);
    await neutralSurface();
    assert.equal((await styles('.landing-nav a', ['visibility'])).visibility, 'visible');
    await page('Network.setBlockedURLs', { urls: ['*r2.dev*'] });
    await page('Emulation.setScriptExecutionDisabled', { value: true });
    try {
        await page('Page.navigate', { url: origin + '/rsvp/engagements/' });
        // Runtime evaluation remains available through CDP when page scripts are disabled.
        await waitFor('document.querySelector(".landing-copy h1")', 'no-JS landing');
        assert.equal((await styles('body', ['backgroundImage'])).backgroundImage, 'none');
        assert.equal((await styles('.landing-nav a', ['visibility'])).visibility, 'visible');
    } finally {
        await page('Emulation.setScriptExecutionDisabled', { value: false });
        await page('Fetch.disable');
        protocolHandlers.delete('Fetch.requestPaused');
    }
});
