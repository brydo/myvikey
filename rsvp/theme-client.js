import { eventTypes, theme, normalizeAppearance, defaultCopy, defaultCardStyle, copyFields, styleFields } from './themes.js';

var appearances = {};
eventTypes.forEach(function (type) { appearances[type] = normalizeAppearance(type, {}); });
var targets = new Map();
var revision = 0;

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
        '--card-alignment': style.alignment, '--card-spacing': style.spacing + 'px'
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

function update(settings) {
    revision++;
    eventTypes.forEach(function (type) {
        appearances[type] = normalizeAppearance(type, settings && settings[type]);
    });
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
        return true;
    } catch {
        return false;
    }
}

window.RSVPThemes = {
    theme: theme, apply: apply, update: update, load: load,
    background: function (type) { return appearances[theme(type)].backgroundImage; },
    settings: function (type) { return appearances[theme(type)]; },
    copy: function (type, key) { return appearances[theme(type)].copy[key]; },
    preview: function (root, type, value) { paint(root, theme(type), normalizeAppearance(theme(type), value)); },
    defaults: function (type) {
        return { copy: defaultCopy(type), cardStyle: defaultCardStyle(type) };
    },
    copyFields: copyFields, styleFields: styleFields
};
apply(document.body, document.body.getAttribute('data-event-type'));
window.RSVPThemes.ready = load();
