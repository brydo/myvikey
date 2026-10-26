import { eventTypes, theme, normalizeAppearance, defaultCopy, defaultCardStyle, copyFields, styleFields, contrastIssues, buttonHover } from './themes.js';

var appearances = {};
eventTypes.forEach(function (type) { appearances[type] = normalizeAppearance(type, {}); });
var targets = new Map();
var revision = 0;
var savedKey = 'rsvp_appearance_saved';
var readyClass = 'rsvp-theme-ready';
var loadingClass = 'rsvp-theme-loading';
var neutralClass = 'rsvp-theme-neutral';
var waitLimit = 6000;
var settingsState = 'loading';
var categoryState = 'ready';
var categoryRevision = 0;
var backgrounds = new WeakMap();

function surface(root, state) {
    root.classList.toggle(loadingClass, state === 'loading');
    root.classList.toggle(readyClass, state === 'ready');
    root.classList.toggle(neutralClass, state === 'failed');
}

function bounded(task, cancel) {
    var timer;
    return Promise.race([task, new Promise(function (_, reject) {
        timer = setTimeout(function () {
            if (cancel) cancel();
            reject(new Error('Theme request timed out'));
        }, waitLimit);
    })]).finally(function () { clearTimeout(timer); });
}

function backgroundReady(root, url) {
    var gate = root === document.body ?
        (settingsState === 'failed' || categoryState === 'failed' ? 'failed' :
            settingsState === 'loading' || categoryState === 'loading' ? 'loading' : 'ready') : 'ready';
    var key = gate + ':' + url;
    var previous = backgrounds.get(root);
    if (previous && previous.key === key) return previous.ready;
    var current = { key: key };
    backgrounds.set(root, current);
    surface(root, gate === 'ready' && !url ? 'ready' : gate === 'failed' ? 'failed' : 'loading');
    current.ready = Promise.resolve();
    if (gate !== 'ready' || !url) return current.ready;
    var image = new Image();
    current.ready = bounded(new Promise(function (resolve, reject) {
        image.onload = function () {
            // Decode before exposing CSS backgrounds, not merely after receiving the bytes.
            (image.decode ? image.decode() : Promise.resolve()).then(resolve, reject);
        };
        image.onerror = reject;
        image.src = url;
    }), function () { image.src = ''; }).then(function () {
        if (backgrounds.get(root) === current) surface(root, 'ready');
    }, function () {
        if (backgrounds.get(root) === current) surface(root, 'failed');
    }).finally(function () { image.onload = image.onerror = null; });
    return current.ready;
}

function refreshBackground() {
    var type = targets.get(document.body);
    return backgroundReady(document.body, appearances[theme(type)].backgroundImage);
}

// Invitation lookup owns the final category; a URL hint or saved receipt is provisional.
function beginCategory() {
    var started = ++categoryRevision;
    categoryState = 'loading';
    refreshBackground();
    var timer = setTimeout(function () {
        if (categoryRevision !== started) return;
        categoryState = 'failed';
        refreshBackground();
    }, waitLimit);
    return function (success) {
        clearTimeout(timer);
        if (categoryRevision !== started) return Promise.resolve();
        categoryState = success ? 'ready' : 'failed';
        return refreshBackground();
    };
}

function paint(root, type, settings) {
    type = theme(type);
    root.setAttribute('data-event-type', type);
    var url = settings.backgroundImage;
    root.style.setProperty('--category-image', url ? 'url("' + url + '")' : 'var(--backdrop)');
    root.style.setProperty('--category-banner', url ? 'url("' + url + '")' : 'var(--banner)');
    root.style.setProperty('--image-symbol', url ? 'none' : 'initial');
    root.setAttribute('data-background-image', url ? 'true' : 'false');
    var style = settings.cardStyle;
    Object.entries({
        '--card-surface': style.surface, '--card-text': style.textColor,
        '--card-heading': style.headingColor, '--card-body-scale': style.bodyScale,
        '--card-heading-scale': style.headingScale, '--card-line-height': style.lineHeight,
        '--card-alignment': style.alignment, '--card-spacing': style.spacing + 'px',
        '--btn-bg': style.buttonBackground, '--btn-text': style.buttonText,
        '--btn-border': style.buttonBorder, '--btn-hover-bg': buttonHover(style)
    }).forEach(function (entry) { root.style.setProperty(entry[0], String(entry[1])); });
    root.querySelectorAll('[data-copy]').forEach(function (element) {
        if (element.closest('[data-event-type]') !== root) return;
        var key = element.getAttribute('data-copy');
        if (Object.hasOwn(settings.copy, key)) element.textContent = settings.copy[key];
    });
}

function apply(root, type) {
    type = theme(type);
    targets.set(root, type);
    if (root === document.body) backgroundReady(root, appearances[type].backgroundImage);
    paint(root, type, appearances[type]);
}

// Settings this browser saved successfully. KV edge reads can lag a save by about a minute,
// so a newer local revision wins until the server catches up.
function savedLocally() {
    try {
        var value = JSON.parse(localStorage.getItem(savedKey));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

function writeLocal(value) {
    try { localStorage.setItem(savedKey, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}

function hydrateFromLocal() {
    var local = savedLocally();
    eventTypes.forEach(function (type) {
        if (!Object.hasOwn(local, type)) return;
        appearances[type] = normalizeAppearance(type, local[type]);
    });
}

function update(settings, savedType) {
    revision++;
    settingsState = 'ready';
    var local = savedLocally();
    var changed = false;
    eventTypes.forEach(function (type) {
        var server = normalizeAppearance(type, settings && settings[type]);
        if (type === savedType && server.updatedAt) {
            local[type] = server;
            changed = true;
            appearances[type] = server;
            return;
        }
        var mine = Object.hasOwn(local, type) ? normalizeAppearance(type, local[type]) : null;
        if (mine && mine.updatedAt > server.updatedAt) {
            appearances[type] = mine;
            return;
        }
        if (mine) {
            delete local[type];
            changed = true;
        }
        appearances[type] = server;
    });
    if (changed) writeLocal(local);
    targets.forEach(function (type, root) {
        if (root.isConnected === false) targets.delete(root);
        else apply(root, type);
    });
}

async function load() {
    var started = revision;
    settingsState = 'loading';
    refreshBackground();
    var controller = new AbortController();
    try {
        var data = await bounded((async function () {
            var response = await fetch('/api/rsvp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
                body: JSON.stringify({ action: 'get-appearance' })
            });
            var data = await response.json();
            if (!response.ok || !data.success) throw new Error('Appearance unavailable');
            return data;
        })(), function () { controller.abort(); });
        if (revision === started) update(data.appearance);
        await refreshBackground();
        return true;
    } catch {
        // Keep content usable, but never reveal an unverified cached/default background.
        if (revision === started) settingsState = 'failed';
        await refreshBackground();
        return false;
    }
}

window.RSVPThemes = {
    theme: theme, apply: apply, update: update, load: load, beginCategory: beginCategory,
    background: function (type) { return appearances[theme(type)].backgroundImage; },
    settings: function (type) { return appearances[theme(type)]; },
    copy: function (type, key) { return appearances[theme(type)].copy[key]; },
    // Previews show the exact draft colours; contrast problems are reported, never silently replaced.
    preview: function (root, type, value) {
        var settings = normalizeAppearance(theme(type), value, { repair: false });
        backgroundReady(root, settings.backgroundImage);
        paint(root, theme(type), settings);
    },
    normalize: function (type, value) { return normalizeAppearance(theme(type), value, { repair: false }); },
    issues: function (type, cardStyle) {
        return contrastIssues(normalizeAppearance(theme(type), { cardStyle: cardStyle }, { repair: false }).cardStyle);
    },
    defaults: function (type) {
        return { copy: defaultCopy(type), cardStyle: defaultCardStyle(type) };
    },
    copyFields: copyFields, styleFields: styleFields
};

document.body.classList.add(loadingClass);
hydrateFromLocal();
apply(document.body, document.body.getAttribute('data-event-type'));
window.RSVPThemes.ready = load();
