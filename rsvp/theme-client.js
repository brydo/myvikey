import { eventTypes, theme, normalizeAppearance, defaultCopy, defaultCardStyle, copyFields, styleFields, contrastIssues, buttonHover } from './themes.js';

var appearances = {};
eventTypes.forEach(function (type) { appearances[type] = normalizeAppearance(type, {}); });
var targets = new Map();
var revision = 0;
var savedKey = 'rsvp_appearance_saved';
var readyClass = 'rsvp-theme-ready';
var loadingClass = 'rsvp-theme-loading';

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

function markReady(root) {
    if (!root) return;
    root.classList.remove(loadingClass);
    root.classList.add(readyClass);
}

function update(settings, savedType) {
    revision++;
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
    try {
        var response = await fetch('/api/rsvp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ action: 'get-appearance' })
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error('Appearance unavailable');
        if (revision === started) update(data.appearance);
        markReady(document.body);
        return true;
    } catch {
        // If server fetch fails, keep UI usable with local/default theme and still reveal page.
        markReady(document.body);
        return false;
    }
}

window.RSVPThemes = {
    theme: theme, apply: apply, update: update, load: load,
    background: function (type) { return appearances[theme(type)].backgroundImage; },
    settings: function (type) { return appearances[theme(type)]; },
    copy: function (type, key) { return appearances[theme(type)].copy[key]; },
    // Previews show the exact draft colours; contrast problems are reported, never silently replaced.
    preview: function (root, type, value) {
        paint(root, theme(type), normalizeAppearance(theme(type), value, { repair: false }));
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
hydrateFromLocal(); // Prefer last saved local appearance immediately; avoids wrong-image flash.
apply(document.body, document.body.getAttribute('data-event-type'));
window.RSVPThemes.ready = load();

// Safety valve: never leave page in loading state if fetch stalls.
setTimeout(function () { markReady(document.body); }, 2500);
