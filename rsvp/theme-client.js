import { eventTypes, theme, normalizeAppearance, normalizeBranding, defaultBranding, defaultCopy, defaultCardStyle, copyFields, styleFields, contrastIssues, buttonHover, safeBackground } from './themes.js';

var appearances = {};
eventTypes.forEach(function (type) { appearances[type] = normalizeAppearance(type, {}); });
var branding = defaultBranding();
var targets = new Map();
var revision = 0;
var brandingRevision = 0;
var savedKey = 'rsvp_appearance_saved';
var readyClass = 'rsvp-theme-ready';
var loadingClass = 'rsvp-theme-loading';
var neutralClass = 'rsvp-theme-neutral';
var waitLimit = 6000;
var settingsState = 'loading';
var categoryState = 'ready';
var categoryRevision = 0;
var backgrounds = new WeakMap();
var banners = new WeakMap();
// Per-event background overrides, keyed by the root they were applied to.
var eventBackgrounds = new Map();
var eventBanners = new Map();
var invitationRoots = new WeakSet();
var defaultDocumentTitle = document.title;

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
    var key = JSON.stringify([gate, url]);
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

function bannerReady(root, url, background) {
    var separate = url && url !== background ? url : '';
    var previous = banners.get(root);
    if (previous && previous.url === separate) return;
    var current = { url: separate };
    banners.set(root, current);
    var warning = root.classList.contains('appearance-preview') ? root.querySelector('[data-banner-warning]') : null;
    if (warning) warning.hidden = true;
    root.classList.remove('rsvp-banner-failed');
    root.classList.toggle('rsvp-banner-unavailable', !!separate);
    if (!separate) return;
    var image = new Image();
    bounded(new Promise(function (resolve, reject) {
        image.onload = function () {
            (image.decode ? image.decode() : Promise.resolve()).then(resolve, reject);
        };
        image.onerror = reject;
        image.src = separate;
    }), function () { image.src = ''; }).then(function () {
        if (banners.get(root) === current) root.classList.remove('rsvp-banner-unavailable');
    }, function () {
        if (banners.get(root) === current) {
            root.classList.add('rsvp-banner-failed');
            if (warning) warning.hidden = false;
            console.warn('RSVP header image could not be loaded or decoded.');
        }
    }).finally(function () { image.onload = image.onerror = null; });
}

function refreshBackground() {
    var type = targets.get(document.body);
    var settings = eventSettings(document.body, type);
    return backgroundReady(document.body, settings.backgroundImage);
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

function isMainLanding() {
    var path = window.location.pathname || '';
    return /^\/rsvp\/(index\.html)?$/.test(path) && !new URLSearchParams(window.location.search).get('id');
}

function paintBranding(root) {
    var active = isMainLanding() ? defaultBranding() : branding;
    var profile = active.profiles.find(function (item) { return item.id === active.activeId; }) ||
        active.profiles.find(function (item) { return item.id === 'vikey'; });
    if (!profile) return;
    root.querySelectorAll('[data-branding]').forEach(function (element) {
        if (element.closest('[data-event-type]') !== root) return;
        var defaultProfile = profile.id === 'vikey' && profile.name === 'V I Key® · RSVP' &&
            !profile.logoUrl && !profile.address;
        var logo = element.querySelector('[data-brand-logo]');
        var name = element.querySelector('[data-brand-name]');
        var address = element.querySelector('[data-brand-address]');
        var hidden = profile.id === 'none';
        element.hidden = hidden;
        if (logo) {
            logo.hidden = hidden || !profile.logoUrl;
            if (profile.logoUrl) logo.src = profile.logoUrl;
            else logo.removeAttribute('src');
        }
        if (name) {
            name.hidden = hidden || !profile.name;
            if (!defaultProfile) name.textContent = profile.name;
        }
        if (address) {
            address.hidden = hidden || !profile.address;
            address.textContent = profile.address;
        }
    });
    var defaultProfile = active.activeId === 'vikey' &&
        profile && profile.name === 'V I Key® · RSVP' && !profile.logoUrl && !profile.address;
    if (root === document.body && typeof defaultDocumentTitle === 'string') {
        document.title = active.activeId === 'none' ?
            defaultDocumentTitle.replace(/\s*[·-]\s*V I Key®/g, '') :
            defaultProfile ? defaultDocumentTitle : defaultDocumentTitle.replace(/V I Key®/g, profile.name);
    }
    root.querySelectorAll('[data-brand-footer], [data-copy="homeLink"]').forEach(function (element) {
        if (element.closest('[data-event-type]') !== root) return;
        if (defaultProfile) {
            element.hidden = false;
            if (element.getAttribute('data-brand-footer') !== null) element.textContent = 'V I Key®';
            return;
        }
        element.hidden = active.activeId === 'none';
        element.textContent = active.activeId === 'none' ? '' : 'Home';
    });
}

function paint(root, type, settings) {
    type = theme(type);
    root.setAttribute('data-event-type', type);
    var url = settings.backgroundImage;
    var banner = settings.bannerImage || url;
    root.style.setProperty('--category-image', url ? 'url("' + url + '")' : 'var(--backdrop)');
    root.style.setProperty('--category-banner', banner ? 'url("' + banner + '")' : 'var(--banner)');
    root.style.setProperty('--image-symbol', banner ? 'none' : 'initial');
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
    paintBranding(root);
}

function eventSettings(root, type) {
    var settings = appearances[theme(type)];
    var eventBackground = eventBackgrounds.get(root);
    var eventBanner = eventBanners.get(root);
    settings = Object.assign({}, settings, {
        backgroundImage: eventBackground || settings.backgroundImage,
        bannerImage: invitationRoots.has(root) ? eventBanner || settings.bannerImage : ''
    });
    return settings;
}

function apply(root, type) {
    type = theme(type);
    targets.set(root, type);
    var settings = eventSettings(root, type);
    if (root === document.body) backgroundReady(root, settings.backgroundImage);
    paint(root, type, settings);
    bannerReady(root, settings.bannerImage, settings.backgroundImage);
}

// Lets one event override the category background without affecting other events.
function applyEvent(root, type, eventBackground) {
    eventBackgrounds.set(root, safeBackground(eventBackground) ? eventBackground : '');
    apply(root, type);
}

function applyInvitation(root, type, eventBackground, eventBanner) {
    invitationRoots.add(root);
    eventBanners.set(root, safeBackground(eventBanner) ? eventBanner : '');
    applyEvent(root, type, eventBackground);
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

function updateBranding(value) {
    if (value === undefined) return;
    brandingRevision++;
    branding = normalizeBranding(value);
    targets.forEach(function (type, root) {
        if (root.isConnected === false) targets.delete(root);
        else apply(root, type);
    });
}

async function load() {
    var started = revision;
    var brandingStarted = brandingRevision;
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
        if (brandingRevision === brandingStarted) updateBranding(data.branding);
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
    theme: theme, apply: apply, applyEvent: applyEvent, applyInvitation: applyInvitation, update: update, updateBranding: updateBranding, load: load, beginCategory: beginCategory,
    branding: function () { return branding; },
    background: function (type) { return appearances[theme(type)].backgroundImage; },
    settings: function (type) { return appearances[theme(type)]; },
    copy: function (type, key) { return appearances[theme(type)].copy[key]; },
    // Previews show the exact draft colours; contrast problems are reported, never silently replaced.
    preview: function (root, type, value) {
        var settings = normalizeAppearance(theme(type), value, { repair: false });
        backgroundReady(root, settings.backgroundImage);
        paint(root, theme(type), settings);
        bannerReady(root, settings.bannerImage, settings.backgroundImage);
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
