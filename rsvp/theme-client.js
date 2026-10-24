import { eventTypes, theme, defaultBackgrounds, safeBackground } from './themes.js';

var backgrounds = Object.assign({}, defaultBackgrounds);
var targets = new Map();
var revision = 0;

function apply(root, type) {
    type = theme(type);
    targets.set(root, type);
    root.setAttribute('data-event-type', type);
    var url = backgrounds[type];
    root.style.setProperty('--category-image', url ? 'url("' + url + '")' : 'var(--backdrop)');
    root.style.setProperty('--category-banner', url ? 'url("' + url + '")' : 'var(--banner)');
    root.style.setProperty('--image-symbol', url ? 'none' : 'initial');
    root.setAttribute('data-background-image', url ? 'true' : 'false');
}

function update(settings) {
    revision++;
    eventTypes.forEach(function (type) {
        var value = settings && settings[type] && settings[type].backgroundImage;
        backgrounds[type] = safeBackground(value) ? value : defaultBackgrounds[type];
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
    background: function (type) { return backgrounds[theme(type)]; }
};
apply(document.body, document.body.getAttribute('data-event-type'));
window.RSVPThemes.ready = load();
