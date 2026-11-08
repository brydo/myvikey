import './theme-client.js';
import { invitationId, invitationPath } from './invitation-id.js';
import { safeAudioUrl, safeBackground } from './themes.js';

(function () {
    'use strict';
    var message = document.getElementById('message');
    var receiptKey = 'rsvp_receipt';
    function theme(type) {
        return window.RSVPThemes.theme(type);
    }

    function applyTheme(type) {
        type = theme(type);
        window.RSVPThemes.apply(document.body, type);
    }

    function status(text, error) {
        message.removeAttribute('data-copy');
        message.textContent = text;
        message.classList.toggle('error', !!error);
    }

    // London time (GMT/BST) for display; storage keeps ISO.
    function ukDateTime(value) {
        var date = value ? new Date(value) : null;
        if (!date || isNaN(date.getTime())) return '';
        var byType = {};
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(date).forEach(function (part) { byType[part.type] = part.value; });
        return byType.day + '/' + byType.month + '/' + byType.year + ' ' + byType.hour + ':' + byType.minute;
    }

    function copyStatus(key, type) {
        status(window.RSVPThemes.copy(type, key));
        message.setAttribute('data-copy', key);
    }

    var guestTokens = {};
    function guestToken(id) {
        id = invitationId(id);
        if (!id) return '';
        if (guestTokens[id]) return guestTokens[id];
        try { return sessionStorage.getItem('rsvp_guest:' + id) || ''; } catch (error) { return ''; }
    }
    function saveGuestToken(id, value) {
        id = invitationId(id);
        if (!id) return;
        guestTokens[id] = value;
        try { sessionStorage.setItem('rsvp_guest:' + id, value); } catch (error) { /* Memory still works. */ }
    }
    async function post(path, payload, token, guest) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-Admin-Session'] = token;
        if (guest) headers['X-RSVP-Guest-Token'] = guest;
        var response = await fetch(path, {
            method: 'POST', headers: headers, body: JSON.stringify(payload)
        });
        var data = await response.json();
        if (!response.ok || !data.success) {
            var error = new Error(data.error || 'Request failed. Please try again.');
            error.status = response.status;
            error.passwordProtected = data.passwordProtected;
            error.fields = Array.isArray(data.fields) ? data.fields : [];
            throw error;
        }
        return data;
    }

    var form = document.getElementById('rsvpForm');
    if (form) {
        var invitation = null;
        var shortRoute = /^\/rsvp\/i\/([^/]+)\/?$/.exec(window.location.pathname || '');
        var eventId = shortRoute ? shortRoute[1] : new URLSearchParams(window.location.search).get('id');
        var unlock = document.getElementById('guestUnlock');
        var openRsvp = document.getElementById('openRsvp');
        var openMusicInvitation = document.getElementById('openMusicInvitation');
        var musicPlayer = document.getElementById('musicPlayer');
        var musicPanel = document.getElementById('invitationMusic');
        var musicStatus = document.getElementById('musicStatus');
        var musicAttempt = 0;
        function showMusicInvitation() {
            openMusicInvitation.hidden = true;
            document.getElementById('invitationText').hidden = false;
            musicPanel.hidden = false;
            openRsvp.hidden = false;
        }
        openMusicInvitation.addEventListener('click', function () {
            var attempt = ++musicAttempt;
            showMusicInvitation();
            musicStatus.textContent = '';
            musicPlayer.play().catch(function () {
                if (attempt === musicAttempt) musicStatus.textContent = 'Music could not be played. Try the player controls, or continue without music.';
            });
        });
        musicPlayer.addEventListener('error', function () {
            if (!musicPanel.hidden) musicStatus.textContent = 'Music could not be loaded. You can continue without it.';
        });
        openRsvp.addEventListener('click', function () {
            form.hidden = false;
            openRsvp.hidden = true;
            form.elements.name.focus();
        });
        if (eventId) {
            var finishInvitationTheme = window.RSVPThemes.beginCategory();
            var revealInvitation = function () {
                if (document.documentElement) document.documentElement.classList.remove('rsvp-invitation-pending');
            };
            document.getElementById('occasionChooser').hidden = true;
            status('Opening your invitation…');
            var loadInvitation = function () { return post('/api/rsvp', { action: 'get-invitation', id: eventId },
                null, guestToken(eventId)).then(function (data) {
                invitation = data.invitation;
                if (unlock) unlock.hidden = true;
                // These two fields belong to this invitation, never the category.
                document.getElementById('heading').removeAttribute('data-copy');
                document.getElementById('invitationText').removeAttribute('data-copy');
                window.RSVPThemes.applyInvitation(document.body, invitation.eventType, invitation.backgroundImage, invitation.bannerImage);
                var themed = finishInvitationTheme(true);
                document.getElementById('heading').textContent = invitation.title;
                document.getElementById('invitationText').textContent = invitation.text;
                document.getElementById('invitationHelp').hidden = true;
                form.elements.event.value = invitation.title;
                form.querySelector('button').disabled = false;
                if (invitation.audioUrl) {
                    document.getElementById('invitationText').hidden = true;
                    openRsvp.hidden = true;
                    openMusicInvitation.hidden = false;
                    musicPanel.hidden = true;
                    musicStatus.textContent = '';
                    musicPlayer.src = invitation.audioUrl;
                    var attempt = ++musicAttempt;
                    musicPlayer.play().then(function () {
                        if (attempt === musicAttempt) showMusicInvitation();
                    }).catch(function () {
                        // The open button remains available when autoplay is blocked or the audio fails.
                    });
                } else {
                    openMusicInvitation.hidden = true;
                    musicPanel.hidden = true;
                    document.getElementById('invitationText').hidden = false;
                    openRsvp.hidden = false;
                }
                status('');
                // Reveal once saved settings and the chosen image (both bounded) have settled too.
                return Promise.all([themed, window.RSVPThemes.ready]);
            }).catch(function (error) {
                finishInvitationTheme(false);
                if (error.status === 401 && unlock) {
                    var hadToken = guestToken(eventId);
                    saveGuestToken(eventId, '');
                    if (hadToken && error.passwordProtected === false) return loadInvitation();
                    unlock.hidden = false;
                }
                status(error.message, true);
            }).finally(revealInvitation); };
            if (unlock) unlock.addEventListener('submit', async function (event) {
                event.preventDefault();
                var button = unlock.querySelector('button');
                button.disabled = true;
                var password = unlock.elements.password.value;
                unlock.elements.password.value = '';
                try {
                    var result = await post('/api/rsvp', { action: 'unlock-invitation', id: eventId, password: password });
                    saveGuestToken(eventId, result.guestToken);
                    await loadInvitation();
                } catch (error) { status(error.message, true); }
                finally { password = ''; button.disabled = false; }
            });
            loadInvitation();
        }
        var attending = form.elements.attending;
        var guests = form.elements.guests;
        attending.addEventListener('change', function () {
            guests.disabled = attending.value === 'no';
            if (guests.disabled) guests.value = '0';
        });
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            if (!invitation) return;
            var button = form.querySelector('button');
            button.disabled = true;
            document.getElementById('sendOptions').hidden = true;
            status('Saving your RSVP…');
            var response = {
                eventId: invitation.id,
                name: form.elements.name.value.trim(),
                event: form.elements.event.value.trim(),
                attending: attending.value,
                guests: Number(guests.value),
                notes: form.elements.notes.value.trim()
            };
            try {
                var data = await post('/api/rsvp', Object.assign({ action: 'submit' }, response), null, guestToken(invitation.id));
                copyStatus('savedMessage', invitation.eventType);
                window.RSVP.sendOptions(document.getElementById('sendOptions'), data.response, data.organiser);
                try {
                    sessionStorage.setItem(receiptKey, JSON.stringify({
                        response: data.response, organiser: data.organiser,
                        eventType: theme(invitation.eventType)
                    }));
                    window.location.assign('/rsvp/view?type=' + theme(invitation.eventType) +
                        '&id=' + invitation.id);
                } catch (storageError) {
                    // Keep the reply and send options here if browser storage is unavailable.
                }
            } catch (error) {
                if (error.status === 401 && unlock) {
                    saveGuestToken(eventId, '');
                    invitation = null;
                    musicAttempt++;
                    musicPlayer.pause();
                    musicPlayer.removeAttribute('src');
                    musicPanel.hidden = true;
                    openMusicInvitation.hidden = true;
                    form.hidden = true;
                    openRsvp.hidden = true;
                    unlock.hidden = false;
                    if (error.passwordProtected === false) await loadInvitation();
                }
                status(error.message || 'Unable to send your RSVP. Please try again.', true);
            } finally {
                button.disabled = false;
            }
        });
    }

    var receipt = document.getElementById('receipt');
    if (receipt) {
        var finishReceiptTheme = window.RSVPThemes.beginCategory();
        var receiptParams = new URLSearchParams(window.location.search);
        applyTheme(receiptParams.get('type'));
        var receiptId = receiptParams.get('id');
        var back = document.querySelector('nav a');
        back.href = invitationId(receiptId) ?
            invitationPath(receiptId) :
            (theme(receiptParams.get('type')) === 'celebration' ? '/rsvp/' : '/rsvp/' + theme(receiptParams.get('type')) + '/');
        function receiptTheme(type, eventBackground) {
            window.RSVPThemes.applyEvent(document.body, type, eventBackground || '');
            if (receipt.children.length) window.RSVPThemes.apply(receipt.children[0], type);
            window.RSVPThemes.apply(document.getElementById('sendOptions'), type);
        }
        function resolveReceiptTheme(id) {
            if (!id) {
                finishReceiptTheme(true);
                return;
            }
            post('/api/rsvp', { action: 'get-invitation', id: id }, null, guestToken(id)).then(function (data) {
                receiptTheme(data.invitation.eventType, data.invitation.backgroundImage);
                finishReceiptTheme(true);
            }).catch(function () {
                // Keep saved receipt content, but not its unverified background.
                finishReceiptTheme(false);
            });
        }
        try {
            var saved = JSON.parse(sessionStorage.getItem(receiptKey));
            if (saved && (!receiptId || (saved.response || saved).eventId === invitationId(receiptId))) {
                var reply = saved.response || saved;
                var savedType = theme(saved.eventType || reply.eventType || receiptParams.get('type'));
                applyTheme(savedType);
                window.RSVP.render(receipt, Object.assign({}, reply, { eventType: savedType }));
                window.RSVP.sendOptions(document.getElementById('sendOptions'), reply, saved.organiser);
                document.getElementById('receiptHeading').setAttribute('data-copy', 'receiptHeading');
                document.getElementById('receiptHeading').textContent = window.RSVPThemes.copy(savedType, 'receiptHeading');
                copyStatus('receiptMessage', savedType);
                if (reply.eventId) {
                    document.querySelector('nav a').href = invitationPath(reply.eventId);
                }
                receiptId = reply.eventId || receiptId;
            }
        } catch (error) {
            status('Your confirmation is unavailable in this tab. If you already submitted, your RSVP is still recorded.');
        }
        resolveReceiptTheme(receiptId);
    }

    var login = document.getElementById('loginForm');
    if (!login) return;
    var token = '';
    var cursor = '';
    var responses = document.getElementById('responses');
    var actions = document.getElementById('adminActions');
    var more = document.getElementById('more');
    var editor = document.getElementById('invitationForm');
    var share = document.getElementById('shareInvitation');
    var eventsPanel = document.getElementById('eventsPanel');
    var repliesPanel = document.getElementById('repliesPanel');
    var repliesStatus = document.getElementById('repliesStatus');
    var events = document.getElementById('events');
    var replyEvent = document.getElementById('replyEvent');
    var invitations = [];
    var pendingInvitations = new Map();
    var refreshVersion = 0;
    var loadVersion = 0;
    var deleting = false;
    var cleanupJobs = [];
    var initialTheme = theme(new URLSearchParams(window.location.search).get('type'));
    var appearanceForm = document.getElementById('appearanceForm');
    var brandingForm = document.getElementById('brandingForm');
    var sponsorProfile = document.getElementById('sponsorProfile');
    var sponsorName = document.getElementById('sponsorName');
    var sponsorLogo = document.getElementById('sponsorLogo');
    var sponsorAddress = document.getElementById('sponsorAddress');
    var brandingStatus = document.getElementById('brandingStatus');
    var sponsorProfiles = [];
    var sponsorIdCounter = 0;
    var backgroundInput = document.getElementById('backgroundImage');
    var bannerInput = document.getElementById('bannerImage');
    var copyEditor = document.getElementById('copyEditor');
    var styleEditor = document.getElementById('styleEditor');
    var appearancePreview = document.getElementById('appearancePreview');
    var appearanceStatus = document.getElementById('appearanceStatus');
    var invitationStatus = document.getElementById('invitationStatus');
    var editorMode = document.getElementById('editorMode');
    var musicOptions = document.getElementById('musicOptions');
    var audioFiles = document.getElementById('audioFiles');
    var audioFilesStatus = document.getElementById('audioFilesStatus');
    var audioOptions = [];
    var audioListLoaded = false;
    var audioListVersion = 0;
    function renderAudioFiles() {
        var current = editor.elements.audioUrl.value.trim();
        audioFiles.replaceChildren();
        function option(value, label) {
            var item = document.createElement('option');
            item.value = value;
            item.textContent = label;
            audioFiles.appendChild(item);
        }
        option('', 'No music');
        audioOptions.forEach(function (item) { option(item.url, item.key); });
        if (current && !audioOptions.some(function (item) { return item.url === current; })) {
            option(current, 'Current music link (not in this list)');
        }
        audioFiles.value = current;
    }
    async function loadAudioFiles() {
        var session = token;
        var version = ++audioListVersion;
        audioFilesStatus.textContent = 'Loading audio files…';
        try {
            var response = await fetch('/api/audio', { cache: 'no-store' });
            if (!response.ok) throw new Error('Audio list is unavailable.');
            var data = await response.json();
            if (!data.success || !Array.isArray(data.files)) throw new Error('Audio list is unavailable.');
            if (session !== token || version !== audioListVersion) return;
            var skipped = 0;
            audioOptions = data.files.reduce(function (items, file) {
                if (!file || typeof file.key !== 'string') { skipped++; return items; }
                var url = '/api/audio?file=' + encodeURIComponent(file.key);
                if (!safeAudioUrl(url)) { skipped++; return items; }
                items.push({ key: file.key, url: url });
                return items;
            }, []);
            audioListLoaded = true;
            renderAudioFiles();
            audioFilesStatus.textContent = audioOptions.length ? audioOptions.length + ' audio file(s) available.' :
                'No audio files found in the R2 audio bucket.';
            if (skipped) audioFilesStatus.textContent += ' Some file names cannot be used; rename them in R2.';
        } catch (error) {
            if (session !== token || version !== audioListVersion) return;
            audioFilesStatus.textContent = 'Could not load audio files. Please refresh the list or use a direct link.';
        }
    }
    musicOptions.addEventListener('toggle', function () {
        if (this.open && !audioListLoaded) loadAudioFiles();
    });
    document.getElementById('refreshAudioFiles').addEventListener('click', loadAudioFiles);
    audioFiles.addEventListener('change', function () { editor.elements.audioUrl.value = audioFiles.value; });
    editor.elements.audioUrl.addEventListener('input', renderAudioFiles);
    document.getElementById('removeAudio').addEventListener('click', function () {
        editor.elements.audioUrl.value = '';
        renderAudioFiles();
    });
    var imagePickers = Array.prototype.slice.call(document.querySelectorAll('[data-image-picker]'));
    var imageOptions = [];
    var imageListLoaded = false;
    var imageListVersion = 0;
    function imagePickerInput(picker) { return document.getElementById(picker.getAttribute('data-image-picker')); }
    function imagePickerStatus(text) {
        imagePickers.forEach(function (picker) {
            document.getElementById(picker.id + 'Status').textContent = text;
        });
    }
    function renderImagePickers() {
        imagePickers.forEach(function (picker) {
            var input = imagePickerInput(picker);
            if (!input) return;
            var current = input.value.trim();
            picker.replaceChildren();
            function option(value, label) {
                var item = document.createElement('option');
                item.value = value;
                item.textContent = label;
                picker.appendChild(item);
            }
            option('', picker.getAttribute('data-none-label'));
            imageOptions.forEach(function (item) { option(item.url, item.key); });
            if (current && !imageOptions.some(function (item) { return item.url === current; })) {
                option(current, 'Current image link (not in this list)');
            }
            picker.value = current;
        });
    }
    async function loadImageFiles() {
        if (!imagePickers.length) return;
        var session = token;
        var version = ++imageListVersion;
        imagePickerStatus('Loading images…');
        try {
            var response = await fetch('/api/images', { cache: 'no-store', headers: { 'X-Admin-Session': session } });
            var data = await response.json();
            if (!response.ok || !data.success || !Array.isArray(data.files)) throw new Error('Image list is unavailable.');
            if (session !== token || version !== imageListVersion) return;
            var skipped = 0;
            imageOptions = data.files.reduce(function (items, file) {
                if (!file || typeof file.key !== 'string' || typeof file.url !== 'string' || !file.url || !safeBackground(file.url)) {
                    skipped++;
                    return items;
                }
                items.push({ key: file.key, url: file.url });
                return items;
            }, []);
            imageListLoaded = true;
            renderImagePickers();
            imagePickerStatus(imageOptions.length ? imageOptions.length + ' image(s) available.' :
                'No images found in the image bucket.');
            if (skipped) imagePickerStatus(imageOptions.length + ' image(s) available. Some file names cannot be used; rename them in R2.');
        } catch (error) {
            if (session !== token || version !== imageListVersion) return;
            renderImagePickers();
            imagePickerStatus('Could not load images. Please refresh the list or use a different image link.');
        }
    }
    imagePickers.forEach(function (picker) {
        var input = imagePickerInput(picker);
        if (!input) return;
        picker.addEventListener('change', function () {
            input.value = picker.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        input.addEventListener('input', renderImagePickers);
    });
    document.querySelectorAll('[data-refresh-images]').forEach(function (button) {
        button.addEventListener('click', loadImageFiles);
    });
    var categoryNames = { celebration: 'Classic celebration', events: 'Events', weddings: 'Weddings',
        parties: 'Parties', engagements: 'Engagements' };
    // Unsaved edits per category survive late appearance reads, category switches and failed saves.
    var drafts = {};
    var styleErrors = {};
    function revealField(field) {
        var parent = field.parentElement;
        while (parent) {
            if (parent.tagName === 'DETAILS') parent.open = true;
            parent = parent.parentElement;
        }
    }
    [editor, appearanceForm].forEach(function (form) {
        if (form) form.addEventListener('invalid', function (event) {
            revealField(event.target);
        }, true);
    });
    function invitationMessage(text, error) {
        invitationStatus.textContent = text;
        invitationStatus.classList.toggle('error', !!error);
    }
    function selectedTheme() { return theme(editor.elements.eventType.value); }
    function appearanceMessage(text, state) {
        if (!appearanceStatus) return;
        appearanceStatus.textContent = text;
        appearanceStatus.setAttribute('data-state', state || '');
    }
    function renderSponsorOptions(selectedId) {
        sponsorProfile.replaceChildren();
        sponsorProfiles.forEach(function (profile) {
            var option = document.createElement('option');
            option.value = profile.id;
            option.textContent = profile.id === 'none' ? 'No sponsor branding' : profile.name || 'New sponsor';
            sponsorProfile.appendChild(option);
        });
        sponsorProfile.value = selectedId;
    }
    function showSponsorProfile() {
        var profile = sponsorProfiles.find(function (item) { return item.id === sponsorProfile.value; });
        if (!profile) return;
        sponsorName.value = profile.name;
        sponsorLogo.value = profile.logoUrl;
        sponsorAddress.value = profile.address;
        var disabled = profile.id === 'none';
        sponsorName.disabled = disabled;
        sponsorLogo.disabled = disabled;
        sponsorAddress.disabled = disabled;
    }
    function updateSponsorDraft() {
        var profile = sponsorProfiles.find(function (item) { return item.id === sponsorProfile.value; });
        if (!profile || profile.id === 'none') return;
        profile.name = sponsorName.value;
        profile.logoUrl = sponsorLogo.value;
        profile.address = sponsorAddress.value;
        var option = Array.from(sponsorProfile.querySelectorAll('option')).find(function (item) { return item.value === profile.id; });
        if (option) option.textContent = profile.name || 'New sponsor';
    }
    function fillBrandingEditor() {
        if (!brandingForm) return;
        var current = window.RSVPThemes.branding();
        sponsorProfiles = current.profiles.map(function (profile) { return Object.assign({}, profile); });
        renderSponsorOptions(current.activeId);
        showSponsorProfile();
        brandingStatus.textContent = '';
    }
    function draftAppearance() {
        var draft = { backgroundImage: backgroundInput.value.trim(), bannerImage: bannerInput.value.trim(), copy: {}, cardStyle: {} };
        Object.keys(window.RSVPThemes.copyFields).forEach(function (key) {
            draft.copy[key] = appearanceForm.elements['copy-' + key].value;
        });
        Object.keys(window.RSVPThemes.styleFields).forEach(function (key) {
            var input = appearanceForm.elements['style-' + key];
            draft.cardStyle[key] = input.type === 'number' ? Number(input.value) : input.value;
        });
        return draft;
    }
    function showStyleIssues(issues) {
        Object.entries(window.RSVPThemes.styleFields).forEach(function (entry) {
            if (entry[1].type !== 'color') return;
            var input = appearanceForm.elements['style-' + entry[0]];
            var related = issues.filter(function (issue) { return issue.field === entry[0]; });
            if (related.length) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
            styleErrors[entry[0]].textContent =
                related.map(function (issue) { return issue.message; }).join(' ');
        });
        return issues;
    }
    function previewAppearance() {
        if (!appearancePreview) return;
        var draft = draftAppearance();
        window.RSVPThemes.preview(appearancePreview, selectedTheme(), draft);
        showStyleIssues(window.RSVPThemes.issues(selectedTheme(), draft.cardStyle));
        document.getElementById('previewInvitationTitle').textContent = editor.elements.title.value || 'Your invitation title';
        document.getElementById('previewInvitationText').textContent = editor.elements.text.value || 'Your invitation message appears here.';
    }
    function fillAppearance(settings) {
        backgroundInput.value = settings.backgroundImage;
        bannerInput.value = settings.bannerImage || '';
        renderImagePickers();
        Object.keys(window.RSVPThemes.copyFields).forEach(function (key) {
            appearanceForm.elements['copy-' + key].value = settings.copy[key];
        });
        Object.keys(window.RSVPThemes.styleFields).forEach(function (key) {
            appearanceForm.elements['style-' + key].value = settings.cardStyle[key];
        });
        previewAppearance();
    }
    function showBackground() {
        if (!backgroundInput) return;
        var type = selectedTheme();
        fillAppearance(drafts[type] || window.RSVPThemes.settings(type));
        appearanceMessage(drafts[type] ? 'Unsaved preview for ' + categoryNames[type] +
            ' — not published yet. Save category settings to publish it.' : '', drafts[type] ? 'draft' : '');
    }
    function sameAppearance(type, first, second) {
        var a = window.RSVPThemes.normalize(type, first), b = window.RSVPThemes.normalize(type, second);
        return a.backgroundImage === b.backgroundImage && a.bannerImage === b.bannerImage && JSON.stringify(a.copy) === JSON.stringify(b.copy) &&
            JSON.stringify(a.cardStyle) === JSON.stringify(b.cardStyle);
    }
    if (appearanceForm) {
        Object.entries(window.RSVPThemes.copyFields).forEach(function (entry) {
            var key = entry[0], field = entry[1];
            var label = document.createElement('label');
            label.htmlFor = 'copy-' + key;
            label.textContent = field.label;
            var input = document.createElement('textarea');
            input.id = input.name = 'copy-' + key;
            input.maxLength = field.max;
            input.required = !!field.required;
            input.rows = field.max > 200 ? 3 : 2;
            copyEditor.appendChild(label);
            copyEditor.appendChild(input);
        });
        Object.entries(window.RSVPThemes.styleFields).forEach(function (entry) {
            var key = entry[0], field = entry[1];
            var label = document.createElement('label');
            label.htmlFor = 'style-' + key;
            label.textContent = field.label;
            var input = document.createElement(field.type === 'select' ? 'select' : 'input');
            input.id = input.name = 'style-' + key;
            if (field.type === 'select') {
                ['center', 'left'].forEach(function (value) {
                    var option = document.createElement('option');
                    option.value = value;
                    option.textContent = value;
                    input.appendChild(option);
                });
            } else {
                input.type = field.type;
                if (field.type === 'number') {
                    input.min = field.min;
                    input.max = field.max;
                    input.step = field.step;
                    input.required = true;
                }
            }
            styleEditor.appendChild(label);
            styleEditor.appendChild(input);
            if (field.type === 'color') {
                var error = document.createElement('p');
                error.id = 'style-' + key + '-error';
                error.className = 'field-error';
                input.setAttribute('aria-describedby', error.id);
                styleEditor.appendChild(error);
                styleErrors[key] = error;
            }
        });
        appearanceForm.addEventListener('input', function () {
            drafts[selectedTheme()] = draftAppearance();
            previewAppearance();
            appearanceMessage('Unsaved preview for ' + categoryNames[selectedTheme()] +
                ' — not published yet. Save category settings to publish it.', 'draft');
        });
        editor.addEventListener('input', previewAppearance);
        document.getElementById('resetAppearance').addEventListener('click', function () {
            var settings = window.RSVPThemes.defaults(editor.elements.eventType.value);
            settings.backgroundImage = backgroundInput.value.trim();
            settings.bannerImage = bannerInput.value.trim();
            fillAppearance(settings);
            drafts[selectedTheme()] = draftAppearance();
            appearanceMessage('Default copy and card styles restored in the preview only. Save category settings to publish.', 'draft');
        });
        window.RSVPThemes.ready.then(showBackground);
        window.RSVPThemes.ready.then(fillBrandingEditor);
        appearanceForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            var session = token;
            var type = selectedTheme();
            var draft = draftAppearance();
            var button = appearanceForm.querySelector('button');
            var issues = showStyleIssues(window.RSVPThemes.issues(type, draft.cardStyle));
            if (issues.length) {
                appearanceMessage('Not saved. ' + issues.map(function (issue) { return issue.message; }).join(' ') +
                    ' Your unsaved changes are still here.', 'error');
                var invalid = appearanceForm.elements['style-' + issues[0].field];
                revealField(invalid);
                if (invalid.focus) invalid.focus();
                return;
            }
            button.disabled = true;
            appearanceMessage('Saving ' + categoryNames[type] + ' settings…', 'pending');
            try {
                var data = await post('/api/rsvp', {
                    action: 'save-appearance', eventType: type, ...draft
                }, session);
                if (token !== session) return;
                window.RSVPThemes.update(data.appearance, type);
                if (!sameAppearance(type, window.RSVPThemes.settings(type), draft)) {
                    throw new Error('The server did not confirm your exact settings.');
                }
                // Keep newer edits made while the save was in flight.
                if (drafts[type] && sameAppearance(type, drafts[type], draft)) delete drafts[type];
                if (selectedTheme() === type) showBackground();
                appearanceMessage('Saved and published for ' + categoryNames[type] +
                    ': landing page, invitations, RSVP form and confirmations now use these settings.', 'success');
            } catch (error) {
                if (token !== session) return;
                if (error.status === 401) logout();
                if (error.fields && error.fields.length && selectedTheme() === type) showStyleIssues(error.fields);
                appearanceMessage('Not saved. ' + (error.message || 'Unable to save category settings.') +
                    ' Your unsaved changes are still here.', 'error');
            } finally { button.disabled = false; }
        });
    }
    if (brandingForm) {
        sponsorProfile.addEventListener('change', showSponsorProfile);
        [sponsorName, sponsorLogo, sponsorAddress].forEach(function (input) {
            input.addEventListener('input', updateSponsorDraft);
        });
        document.getElementById('addSponsor').addEventListener('click', function () {
            if (sponsorProfiles.length >= 24) {
                brandingStatus.textContent = 'The maximum of 22 sponsor profiles has been reached.';
                return;
            }
            var id;
            do {
                id = 'sponsor-' + Date.now().toString(36) + '-' + (++sponsorIdCounter).toString(36);
            } while (sponsorProfiles.some(function (profile) { return profile.id === id; }));
            sponsorProfiles.push({ id: id, name: '', logoUrl: '', address: '' });
            renderSponsorOptions(id);
            showSponsorProfile();
            sponsorName.focus();
            brandingStatus.textContent = 'Enter the new sponsor details, then save to publish them.';
        });
        brandingForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            updateSponsorDraft();
            var session = token;
            var button = document.getElementById('saveBranding');
            button.disabled = true;
            brandingStatus.textContent = 'Saving sponsor branding…';
            try {
                var data = await post('/api/rsvp', {
                    action: 'save-branding',
                    branding: { profiles: sponsorProfiles, activeId: sponsorProfile.value }
                }, session);
                if (token !== session) return;
                window.RSVPThemes.updateBranding(data.branding);
                previewAppearance();
                sponsorProfiles = data.branding.profiles.map(function (profile) { return Object.assign({}, profile); });
                renderSponsorOptions(data.branding.activeId);
                showSponsorProfile();
                brandingStatus.textContent = 'Saved. This sponsor now appears on all RSVP invitations and confirmations, regardless of type.';
            } catch (error) {
                if (token !== session) return;
                if (error.status === 401) logout();
                brandingStatus.textContent = 'Not saved. ' + (error.message || 'Unable to save sponsor branding.') +
                    ' Your changes are still here.';
            } finally { button.disabled = false; }
        });
    }
    editor.elements.eventType.value = initialTheme;
    applyTheme(initialTheme);
    showBackground();
    editor.elements.eventType.addEventListener('change', function () {
        applyTheme(editor.elements.eventType.value);
        showBackground();
    });

    function showInvitation(invitation) {
        ['id', 'title', 'text', 'whatsapp', 'sms'].forEach(function (field) {
            editor.elements[field].value = invitation[field] || '';
        });
        editor.elements.eventBackground.value = invitation.backgroundImage || '';
        editor.elements.eventBanner.value = invitation.bannerImage || '';
        renderImagePickers();
        editor.elements.audioUrl.value = invitation.audioUrl || '';
        renderAudioFiles();
        editor.elements.invitesSent.value = invitation.invitesSent || 0;
        editor.elements.eventType.value = theme(invitation.eventType);
        editorMode.textContent = 'Editing: ' + invitation.title + '. Choose New invitation to create another.';
        if (editor.elements.guestPassword) editor.elements.guestPassword.value = '';
        if (editor.elements.removeGuestPassword) editor.elements.removeGuestPassword.checked = false;
        var protectionStatus = document.getElementById('guestProtectionStatus');
        if (protectionStatus) protectionStatus.textContent = invitation.passwordProtected ?
            'Guest password protection is on.' : 'No guest password is set.';
        if (editor.elements.hostPassword) editor.elements.hostPassword.value = '';
        if (editor.elements.removeHostPassword) editor.elements.removeHostPassword.checked = false;
        var hostStatus = document.getElementById('hostProtectionStatus');
        if (hostStatus) hostStatus.textContent = invitation.hostPasswordProtected ?
            'Host access is on. Host login: ' + window.location.origin + '/rsvp/' + theme(invitation.eventType) + '/hostlogin?id=' + invitation.id :
            'No host password is set.';
        applyTheme(invitation.eventType);
        showBackground();
        share.replaceChildren();
        var link = document.createElement('a');
        link.href = window.location.origin + invitationPath(invitation.id);
        link.textContent = link.href;
        share.appendChild(document.createTextNode('Saved invitation — share this link: '));
        share.appendChild(link);
    }

    function resetInvitationEditor() {
        editor.reset();
        renderAudioFiles();
        renderImagePickers();
        editorMode.textContent = 'Creating a new invitation.';
        invitationMessage('');
        var protectionStatus = document.getElementById('guestProtectionStatus');
        if (protectionStatus) protectionStatus.textContent = '';
        var hostStatus = document.getElementById('hostProtectionStatus');
        if (hostStatus) hostStatus.textContent = '';
    }

    editor.addEventListener('submit', async function (event) {
        event.preventDefault();
        var session = token;
        var button = editor.querySelector('button[type="submit"]');
        button.disabled = true;
        invitationMessage('Saving invitation…');
        try {
            var payload = { action: 'save-invitation', eventType: theme(editor.elements.eventType.value) };
            ['title', 'text', 'whatsapp', 'sms'].forEach(function (field) {
                payload[field] = editor.elements[field].value.trim();
            });
            payload.backgroundImage = editor.elements.eventBackground.value.trim();
            payload.bannerImage = editor.elements.eventBanner.value.trim();
            payload.audioUrl = editor.elements.audioUrl.value.trim();
            payload.invitesSent = Number(editor.elements.invitesSent.value) || 0;
            if (editor.elements.id.value.trim()) payload.id = editor.elements.id.value.trim();
            if (editor.elements.guestPassword && editor.elements.guestPassword.value) {
                payload.guestPassword = editor.elements.guestPassword.value;
            }
            if (editor.elements.removeGuestPassword && editor.elements.removeGuestPassword.checked) payload.removeGuestPassword = true;
            if (editor.elements.hostPassword && editor.elements.hostPassword.value) {
                payload.hostPassword = editor.elements.hostPassword.value;
            }
            if (editor.elements.removeHostPassword && editor.elements.removeHostPassword.checked) payload.removeHostPassword = true;
            var data = await post('/api/rsvp', payload, session);
            if (token !== session) return;
            showInvitation(data.invitation);
            pendingInvitations.set(data.invitation.id, data.invitation);
            var index = invitations.findIndex(function (item) { return item.id === data.invitation.id; });
            var counts = index < 0 ? { replyCount: 0, yesCount: 0, maybeCount: 0, noCount: 0 } : {
                replyCount: invitations[index].replyCount, yesCount: invitations[index].yesCount,
                maybeCount: invitations[index].maybeCount, noCount: invitations[index].noCount
            };
            var updated = Object.assign({}, data.invitation, counts);
            if (index < 0) invitations.push(updated);
            else invitations[index] = updated;
            renderEvents();
            invitationMessage('Invitation saved. Share its link with your guests.');
        } catch (error) {
            if (token !== session) return;
            if (error.status === 401) {
                logout();
                status('Your session has expired. Please sign in again.', true);
            } else {
                invitationMessage('Not saved. ' + (error.message || 'Please try again.') +
                    ' Your invitation details are still here.', true);
            }
        } finally { button.disabled = false; }
    });
    document.getElementById('loadInvitation').addEventListener('click', async function () {
        var session = token;
        try {
            var data = await post('/api/rsvp', { action: 'get-invitation', id: editor.elements.id.value.trim() }, session);
            if (token === session) showInvitation(data.invitation);
        } catch (error) { if (token === session) invitationMessage('Could not open invitation. ' + error.message, true); }
    });
    document.getElementById('newInvitation').addEventListener('click', function () {
        resetInvitationEditor();
        editor.elements.eventType.value = initialTheme;
        applyTheme(initialTheme);
        showBackground();
        share.replaceChildren();
        invitationMessage('New invitation. Save to create a separate share link.');
    });

    function renderEvents() {
        var selected = replyEvent.value;
        var total = function (key) { return invitations.reduce(function (sum, item) { return sum + (item[key] || 0); }, 0); };
        document.getElementById('summary').textContent = total('invitesSent') + ' invites sent · ' + total('replyCount') +
            ' replied · ' + total('yesCount') + ' going · ' + total('maybeCount') + ' maybe · ' + total('noCount') + ' not going';
        events.replaceChildren();
        replyEvent.replaceChildren();
        [['', 'All events'], ['unassigned', 'Unassigned (legacy replies)']].concat(
            invitations.map(function (item) { return [item.id, item.title + ' · ' + theme(item.eventType) + ' · ' + item.id]; })
        ).forEach(function (option) {
            var node = document.createElement('option');
            node.value = option[0];
            node.textContent = option[1];
            replyEvent.appendChild(node);
        });
        replyEvent.value = selected;
        if (!replyEvent.value) replyEvent.value = '';
        document.getElementById('exportEvent').disabled = !replyEvent.value;
        invitations.forEach(function (item) {
            var row = document.createElement('article');
            row.className = 'event-item';
            var heading = document.createElement('h3');
            heading.textContent = item.title;
            row.appendChild(heading);
            var details = document.createElement('p');
            details.textContent = 'Type: ' + theme(item.eventType) + ' · Replies: ' + item.replyCount +
                ' (Going: ' + item.yesCount + ', Maybe: ' + item.maybeCount +
                ', Not going: ' + item.noCount + ') · Invites sent: ' + (item.invitesSent || 0);
            row.appendChild(details);
            var code = document.createElement('p');
            code.textContent = 'Invite code: ' + item.id;
            row.appendChild(code);
            if (pendingInvitations.has(item.id)) {
                var pending = document.createElement('p');
                pending.textContent = 'Recently saved; it may take a short time to appear after signing in again.';
                row.appendChild(pending);
            }
            var link = document.createElement('a');
            link.href = window.location.origin + invitationPath(item.id);
            link.textContent = link.href;
            row.appendChild(link);
            function button(label, handler) {
                var control = document.createElement('button');
                control.type = 'button';
                control.className = 'rsvp-btn';
                control.textContent = label;
                control.addEventListener('click', handler);
                row.appendChild(control);
            }
            button('Copy invite code', function () { copy(item.id); });
            button('Copy share link', function () { copy(link.href); });
            button('Open/Edit', function () { showInvitation(item); editor.elements.title.focus(); });
            button('View replies', function () {
                replyEvent.value = item.id;
                filterReplies();
                document.getElementById('repliesHeading').focus();
            });
            button('Export replies (.csv)', function () { exportReplies(item.id); });
            var deleteMode = document.createElement('select');
            deleteMode.setAttribute('aria-label', 'Replies when deleting ' + item.title);
            [['keep', 'Keep replies'], ['delete', 'Delete replies too']].forEach(function (option) {
                var node = document.createElement('option');
                node.value = option[0];
                node.textContent = option[1];
                deleteMode.appendChild(node);
            });
            deleteMode.value = 'keep';
            row.appendChild(deleteMode);
            button('Delete event', function () {
                var deleteReplies = deleteMode.value === 'delete';
                return remove('delete-event', item.id,
                    'Permanently delete "' + item.title + '"? Its shared invitation link will stop working. ' +
                    (deleteReplies ? 'All its replies will also be permanently deleted.' : 'Its replies will be kept.') +
                    ' Export a backup first if needed.',
                    deleteReplies);
            });
            events.appendChild(row);
        });
        if (!invitations.length) events.textContent = 'No saved invitations yet.';
    }

    async function remove(action, id, warning, deleteReplies) {
        if (deleting || !token || !window.confirm(warning)) return;
        var session = token;
        deleting = true;
        if (action === 'delete-event' && deleteReplies && cleanupJobs.indexOf(id) === -1) {
            cleanupJobs.push(id);
            saveCleanupJobs();
        }
        status('Deleting…');
        try {
            var next = '';
            do {
                var payload = { action: action, id: id, cursor: next };
                if (action === 'delete-event') payload.deleteReplies = deleteReplies;
                var data = await post('/api/rsvp', payload, session);
                if (token !== session) return;
                next = data.cursor || '';
            } while (next);
            if (action === 'delete-event' && deleteReplies) {
                cleanupJobs = cleanupJobs.filter(function (job) { return job !== id; });
                saveCleanupJobs();
            }
            if (action === 'delete-event') {
                pendingInvitations.delete(id);
                refreshVersion++;
                if (editor.elements.id.value === id) {
                    resetInvitationEditor();
                    editor.elements.eventType.value = initialTheme;
                    applyTheme(initialTheme);
                    showBackground();
                    share.replaceChildren();
                }
                if (replyEvent.value === id) replyEvent.value = '';
            }
            await refresh();
        } catch (error) {
            if (token !== session) return;
            if (error.status === 401) logout();
            status('Deletion did not complete. Some records may already have been deleted. ' +
                'Refresh to check before retrying. ' + error.message, true);
        } finally {
            deleting = false;
            renderCleanupJobs();
        }
    }

    function saveCleanupJobs() {
        try { sessionStorage.setItem('rsvp_delete_jobs', JSON.stringify(cleanupJobs)); } catch (error) {
            // Keep retry controls available in this page if browser storage is unavailable.
        }
    }

    function renderCleanupJobs() {
        var root = document.getElementById('deletionJobs');
        root.replaceChildren();
        if (!token) return;
        cleanupJobs.forEach(function (id) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'rsvp-btn';
            button.textContent = 'Retry reply cleanup for event ' + id;
            button.addEventListener('click', function () {
                return remove('delete-event', id, 'Permanently delete all remaining replies for event ' +
                    id + '? Its invitation link will be disabled. This cannot be undone.', true);
            });
            root.appendChild(button);
        });
    }

    async function copy(value) {
        try {
            await navigator.clipboard.writeText(value);
            status('Copied to clipboard.');
        } catch (error) {
            status('Copy unavailable. Select and copy the invite code or link shown above.', true);
        }
    }

    async function collect(action, session, eventId) {
        var items = [];
        var next = '';
        do {
            var payload = { action: action, cursor: next };
            if (eventId) payload.eventId = eventId;
            var data = await post('/api/rsvp', payload, session);
            if (token !== session) throw new Error('Admin session changed. Please sign in again.');
            items = items.concat(action === 'list' ? data.responses : data.invitations);
            next = data.cursor || '';
        } while (next);
        return items;
    }

    async function exportReplies(eventId) {
        var session = token;
        if (!session) return;
        var allButton = document.getElementById('exportAll');
        if (allButton.disabled) return;
        allButton.disabled = true;
        status('Preparing export…');
        try {
            var savedEvents = await collect('list-invitations', session);
            var replies = await collect('list', session, eventId);
            if (token !== session) return;
            if (eventId) {
                window.RSVPExport.download(window.RSVPExport.csv(replies), 'rsvp-' + eventId + '.csv', 'text/csv;charset=utf-8');
            } else {
                window.RSVPExport.download(window.RSVPExport.workbook(savedEvents, replies), 'rsvp-all-events.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            }
            status('Export downloaded.');
        } catch (error) {
            if (token !== session) return;
            if (error.status === 401) logout();
            status(error.message || 'Unable to export replies.', true);
        } finally { allButton.disabled = false; }
    }

    function filterReplies() {
        document.getElementById('exportEvent').disabled = !replyEvent.value;
        load(false);
    }
    replyEvent.addEventListener('change', filterReplies);
    document.getElementById('exportEvent').addEventListener('click', function () {
        if (replyEvent.value) exportReplies(replyEvent.value);
    });
    document.getElementById('exportAll').addEventListener('click', function () { exportReplies(); });

    async function refresh() {
        var session = token;
        var version = ++refreshVersion;
        try {
            var items = await collect('list-invitations', session);
            // Count via bounded API pages rather than an unbounded KV scan in one invocation.
            var replies = await collect('list', session);
            if (token !== session || version !== refreshVersion) return;
            pendingInvitations.forEach(function (saved, id) {
                var index = items.findIndex(function (item) { return item.id === id; });
                var fields = ['id', 'eventType', 'title', 'text', 'whatsapp', 'sms', 'invitesSent',
                    'backgroundImage', 'bannerImage', 'audioUrl', 'passwordProtected', 'hostPasswordProtected'];
                if (index >= 0 && fields.every(function (field) { return items[index][field] === saved[field]; })) {
                    pendingInvitations.delete(id);
                } else if (index < 0) {
                    items.push(saved);
                } else {
                    items[index] = saved;
                }
            });
            invitations = items.map(function (item) {
                var mine = replies.filter(function (reply) { return reply.eventId === item.id; });
                var tally = function (value) { return mine.filter(function (reply) { return reply.attending === value; }).length; };
                return Object.assign({}, item, { replyCount: mine.length, yesCount: tally('yes'),
                    maybeCount: tally('maybe'), noCount: tally('no') });
            });
            renderEvents();
            renderCleanupJobs();
            await load(false);
        } catch (error) {
            if (token !== session || version !== refreshVersion) return;
            if (error.status === 401) logout();
            status(error.message || 'Unable to load invitations.', true);
        }
    }

    function logout() {
        token = '';
        cursor = '';
        refreshVersion++;
        audioListVersion++;
        audioListLoaded = false;
        audioOptions = [];
        audioFilesStatus.textContent = '';
        imageListVersion++;
        imageListLoaded = false;
        imageOptions = [];
        imagePickerStatus('');
        renderImagePickers();
        loadVersion++;
        invitations = [];
        pendingInvitations.clear();
        cleanupJobs = [];
        document.getElementById('deletionJobs').replaceChildren();
        events.replaceChildren();
        replyEvent.replaceChildren();
        eventsPanel.hidden = true;
        repliesPanel.hidden = true;
        repliesStatus.textContent = '';
        responses.replaceChildren();
        login.hidden = false;
        actions.hidden = true;
        more.hidden = true;
        editor.hidden = true;
        if (appearanceForm) appearanceForm.hidden = true;
        if (brandingForm) brandingForm.hidden = true;
        drafts = {};
        resetInvitationEditor();
        editor.elements.eventType.value = initialTheme;
        applyTheme(initialTheme);
        showBackground();
        share.replaceChildren();
        status('');
    }

    var groups = new Map();

    function replyStatus(text, error) {
        repliesStatus.textContent = text;
        repliesStatus.classList.toggle('error', !!error);
        status(text, error);
    }

    async function load(append) {
        var session = token;
        var version = ++loadVersion;
        more.disabled = true;
        document.getElementById('refresh').disabled = true;
        if (!append) {
            cursor = '';
            responses.replaceChildren();
            groups = new Map();
        }
        more.hidden = true;
        replyStatus('Loading responses…');
        try {
            var payload = { action: 'list', cursor: cursor };
            if (replyEvent.value) payload.eventId = replyEvent.value;
            var data;
            do {
                data = await post('/api/rsvp', payload, token);
                if (token !== session || version !== loadVersion) return;
                payload.cursor = data.cursor || '';
            } while (!data.responses.length && payload.cursor);
            data.responses.forEach(function (response) {
                var key = response.eventId || 'unassigned';
                var group = groups.get(key);
                if (!group) {
                    group = document.createElement('section');
                    group.className = 'response-group';
                    var groupHeading = document.createElement('h3');
                    groupHeading.textContent = response.event;
                    group.appendChild(groupHeading);
                    groups.set(key, group);
                    responses.appendChild(group);
                }
                var line = document.createElement('article');
                line.className = 'response';
                var summary = document.createElement('p');
                summary.textContent = response.name + ' — ' + ({ yes: 'Going', maybe: 'Maybe' }[response.attending] || 'Not going');
                line.appendChild(summary);
                var details = document.createElement('p');
                details.textContent = 'Additional guests: ' + response.guests;
                line.appendChild(details);
                var notes = document.createElement('p');
                notes.textContent = 'Notes: ' + (response.notes || '—');
                line.appendChild(notes);
                var submitted = document.createElement('p');
                submitted.textContent = 'Submitted: ' + (ukDateTime(response.createdAt) || 'Time unavailable');
                line.appendChild(submitted);
                group.appendChild(line);
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'rsvp-btn';
                button.textContent = 'Delete reply';
                button.addEventListener('click', function () {
                    return remove('delete-reply', response.id,
                        'Permanently delete the reply from "' + response.name + '" for "' + response.event + '"? This cannot be undone.');
                });
                line.appendChild(button);
            });
            cursor = data.cursor || '';
            more.hidden = !cursor;
            replyStatus(groups.size ? 'Responses loaded.' : 'No RSVPs yet.');
        } catch (error) {
            if (token !== session || version !== loadVersion) return;
            if (error.status === 401) logout();
            replyStatus(error.message || 'Unable to load responses. Please try again.', true);
        } finally {
            if (version === loadVersion) {
                more.disabled = false;
                document.getElementById('refresh').disabled = false;
            }
        }
    }

    login.addEventListener('submit', async function (event) {
        event.preventDefault();
        var button = login.querySelector('button');
        button.disabled = true;
        status('Signing in…');
        try {
            var data = await post('/api/password', {
                action: 'verify', id: '__admin__', password: document.getElementById('password').value
            });
            if (!data.sessionToken) throw new Error('Admin session could not be started.');
            token = data.sessionToken;
            try {
                var jobs = JSON.parse(sessionStorage.getItem('rsvp_delete_jobs'));
                cleanupJobs = Array.isArray(jobs) ? jobs.filter(function (id) {
                    return !!invitationId(id);
                }) : [];
            } catch (error) { cleanupJobs = []; }
            login.reset();
            login.hidden = true;
            actions.hidden = false;
            if (appearanceForm) appearanceForm.hidden = false;
            if (brandingForm) {
                brandingForm.hidden = false;
                fillBrandingEditor();
            }
            editor.hidden = false;
            eventsPanel.hidden = false;
            repliesPanel.hidden = false;
            if (musicOptions.open && !audioListLoaded) loadAudioFiles();
            loadImageFiles();
            await refresh();
        } catch (error) {
            status(error.message || 'Unable to sign in. Please try again.', true);
        } finally {
            button.disabled = false;
        }
    });
    document.getElementById('logout').addEventListener('click', logout);
    document.getElementById('refresh').addEventListener('click', refresh);
    more.addEventListener('click', function () { load(true); });
})();
