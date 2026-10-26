import './theme-client.js';

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

    function copyStatus(key, type) {
        status(window.RSVPThemes.copy(type, key));
        message.setAttribute('data-copy', key);
    }

    async function post(path, payload, token) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-Admin-Session'] = token;
        var response = await fetch(path, {
            method: 'POST', headers: headers, body: JSON.stringify(payload)
        });
        var data = await response.json();
        if (!response.ok || !data.success) {
            var error = new Error(data.error || 'Request failed. Please try again.');
            error.status = response.status;
            error.fields = Array.isArray(data.fields) ? data.fields : [];
            throw error;
        }
        return data;
    }

    var form = document.getElementById('rsvpForm');
    if (form) {
        var invitation = null;
        var eventId = new URLSearchParams(window.location.search).get('id');
        var openRsvp = document.getElementById('openRsvp');
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
            post('/api/rsvp', { action: 'get-invitation', id: eventId }).then(function (data) {
                invitation = data.invitation;
                // These two fields belong to this invitation, never the category.
                document.getElementById('heading').removeAttribute('data-copy');
                document.getElementById('invitationText').removeAttribute('data-copy');
                applyTheme(invitation.eventType);
                var themed = finishInvitationTheme(true);
                document.getElementById('heading').textContent = invitation.title;
                document.getElementById('invitationText').textContent = invitation.text;
                document.getElementById('invitationHelp').hidden = true;
                form.elements.event.value = invitation.title;
                form.querySelector('button').disabled = false;
                openRsvp.hidden = false;
                status('');
                // Reveal once saved settings and the chosen image (both bounded) have settled too.
                return Promise.all([themed, window.RSVPThemes.ready]);
            }).catch(function (error) {
                finishInvitationTheme(false);
                status(error.message, true);
            }).finally(revealInvitation);
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
                var data = await post('/api/rsvp', Object.assign({ action: 'submit' }, response));
                copyStatus('savedMessage', invitation.eventType);
                window.RSVP.sendOptions(document.getElementById('sendOptions'), data.response, data.organiser);
                try {
                    sessionStorage.setItem(receiptKey, JSON.stringify({
                        response: data.response, organiser: data.organiser,
                        eventType: theme(invitation.eventType)
                    }));
                    window.location.assign('/rsvp/view?type=' + theme(invitation.eventType) +
                        '&id=' + encodeURIComponent(invitation.id));
                } catch (storageError) {
                    // Keep the reply and send options here if browser storage is unavailable.
                }
            } catch (error) {
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
        back.href = receiptId && /^[0-9a-f-]{36}$/.test(receiptId) ?
            '/rsvp/?id=' + encodeURIComponent(receiptId) :
            (theme(receiptParams.get('type')) === 'celebration' ? '/rsvp/' : '/rsvp/' + theme(receiptParams.get('type')) + '/');
        function receiptTheme(type) {
            applyTheme(type);
            if (receipt.children.length) window.RSVPThemes.apply(receipt.children[0], type);
            window.RSVPThemes.apply(document.getElementById('sendOptions'), type);
        }
        function resolveReceiptTheme(id) {
            if (!id) {
                finishReceiptTheme(true);
                return;
            }
            post('/api/rsvp', { action: 'get-invitation', id: id }).then(function (data) {
                receiptTheme(data.invitation.eventType);
                finishReceiptTheme(true);
            }).catch(function () {
                // Keep saved receipt content, but not its unverified background.
                finishReceiptTheme(false);
            });
        }
        try {
            var saved = JSON.parse(sessionStorage.getItem(receiptKey));
            if (saved && (!receiptId || (saved.response || saved).eventId === receiptId)) {
                var reply = saved.response || saved;
                var savedType = theme(saved.eventType || reply.eventType || receiptParams.get('type'));
                applyTheme(savedType);
                window.RSVP.render(receipt, Object.assign({}, reply, { eventType: savedType }));
                window.RSVP.sendOptions(document.getElementById('sendOptions'), reply, saved.organiser);
                document.getElementById('receiptHeading').setAttribute('data-copy', 'receiptHeading');
                document.getElementById('receiptHeading').textContent = window.RSVPThemes.copy(savedType, 'receiptHeading');
                copyStatus('receiptMessage', savedType);
                if (reply.eventId) {
                    document.querySelector('nav a').href = '/rsvp/?id=' + encodeURIComponent(reply.eventId);
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
    var events = document.getElementById('events');
    var replyEvent = document.getElementById('replyEvent');
    var invitations = [];
    var loadVersion = 0;
    var deleting = false;
    var cleanupJobs = [];
    var initialTheme = theme(new URLSearchParams(window.location.search).get('type'));
    var appearanceForm = document.getElementById('appearanceForm');
    var backgroundInput = document.getElementById('backgroundImage');
    var copyEditor = document.getElementById('copyEditor');
    var styleEditor = document.getElementById('styleEditor');
    var appearancePreview = document.getElementById('appearancePreview');
    var appearanceStatus = document.getElementById('appearanceStatus');
    var categoryNames = { celebration: 'Classic celebration', events: 'Events', weddings: 'Weddings',
        parties: 'Parties', engagements: 'Engagements' };
    // Unsaved edits per category survive late appearance reads, category switches and failed saves.
    var drafts = {};
    var styleErrors = {};
    function selectedTheme() { return theme(editor.elements.eventType.value); }
    function appearanceMessage(text, state) {
        if (!appearanceStatus) return;
        appearanceStatus.textContent = text;
        appearanceStatus.setAttribute('data-state', state || '');
    }
    function draftAppearance() {
        var draft = { backgroundImage: backgroundInput.value.trim(), copy: {}, cardStyle: {} };
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
        return a.backgroundImage === b.backgroundImage && JSON.stringify(a.copy) === JSON.stringify(b.copy) &&
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
            fillAppearance(settings);
            drafts[selectedTheme()] = draftAppearance();
            appearanceMessage('Default copy and card styles restored in the preview only. Save category settings to publish.', 'draft');
        });
        window.RSVPThemes.ready.then(showBackground);
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
        editor.elements.eventType.value = theme(invitation.eventType);
        applyTheme(invitation.eventType);
        showBackground();
        share.replaceChildren();
        var link = document.createElement('a');
        link.href = window.location.origin + '/rsvp/?id=' + encodeURIComponent(invitation.id);
        link.textContent = link.href;
        share.appendChild(document.createTextNode('Saved invitation — share this link: '));
        share.appendChild(link);
    }

    editor.addEventListener('submit', async function (event) {
        event.preventDefault();
        var session = token;
        var button = editor.querySelector('button[type="submit"]');
        button.disabled = true;
        var payload = { action: 'save-invitation', eventType: theme(editor.elements.eventType.value) };
        ['title', 'text', 'whatsapp', 'sms'].forEach(function (field) {
            payload[field] = editor.elements[field].value.trim();
        });
        if (editor.elements.id.value.trim()) payload.id = editor.elements.id.value.trim();
        try {
            var data = await post('/api/rsvp', payload, session);
            if (token !== session) return;
            showInvitation(data.invitation);
            var index = invitations.findIndex(function (item) { return item.id === data.invitation.id; });
            var updated = Object.assign({}, data.invitation, { replyCount: index < 0 ? 0 : invitations[index].replyCount });
            if (index < 0) invitations.push(updated);
            else invitations[index] = updated;
            renderEvents();
            status('Invitation saved. Share its link with your guests.');
        } catch (error) {
            if (token !== session) return;
            if (error.status === 401) logout();
            status(error.message, true);
        } finally { button.disabled = false; }
    });
    document.getElementById('loadInvitation').addEventListener('click', async function () {
        var session = token;
        try {
            var data = await post('/api/rsvp', { action: 'get-invitation', id: editor.elements.id.value.trim() });
            if (token === session) showInvitation(data.invitation);
        } catch (error) { if (token === session) status(error.message, true); }
    });
    document.getElementById('newInvitation').addEventListener('click', function () {
        editor.reset();
        editor.elements.eventType.value = initialTheme;
        applyTheme(initialTheme);
        showBackground();
        share.replaceChildren();
        status('New invitation. Save to create a separate share link.');
    });

    function renderEvents() {
        var selected = replyEvent.value;
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
            details.textContent = 'Type: ' + theme(item.eventType) + ' · Replies: ' + item.replyCount;
            row.appendChild(details);
            var code = document.createElement('p');
            code.textContent = 'Invite code: ' + item.id;
            row.appendChild(code);
            var link = document.createElement('a');
            link.href = window.location.origin + '/rsvp/?id=' + encodeURIComponent(item.id);
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
            button('View replies', function () { replyEvent.value = item.id; filterReplies(); });
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
                if (editor.elements.id.value === id) {
                    editor.reset();
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
        try {
            var items = await collect('list-invitations', session);
            // Count via bounded API pages rather than an unbounded KV scan in one invocation.
            var replies = await collect('list', session);
            if (token !== session) return;
            var counts = new Map();
            replies.forEach(function (reply) { counts.set(reply.eventId, (counts.get(reply.eventId) || 0) + 1); });
            invitations = items.map(function (item) {
                return Object.assign({}, item, { replyCount: counts.get(item.id) || 0 });
            });
            renderEvents();
            renderCleanupJobs();
            await load(false);
        } catch (error) {
            if (token !== session) return;
            if (error.status === 401) logout();
            status(error.message || 'Unable to load invitations.', true);
        }
    }

    function logout() {
        token = '';
        cursor = '';
        loadVersion++;
        invitations = [];
        cleanupJobs = [];
        document.getElementById('deletionJobs').replaceChildren();
        events.replaceChildren();
        replyEvent.replaceChildren();
        eventsPanel.hidden = true;
        responses.replaceChildren();
        login.hidden = false;
        actions.hidden = true;
        more.hidden = true;
        editor.hidden = true;
        if (appearanceForm) appearanceForm.hidden = true;
        drafts = {};
        editor.reset();
        editor.elements.eventType.value = initialTheme;
        applyTheme(initialTheme);
        showBackground();
        share.replaceChildren();
        status('');
    }

    async function load(append) {
        var session = token;
        var version = ++loadVersion;
        more.disabled = true;
        document.getElementById('refresh').disabled = true;
        if (!append) {
            cursor = '';
            responses.replaceChildren();
        }
        more.hidden = true;
        status('Loading responses…');
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
                window.RSVP.render(responses, response);
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'rsvp-btn';
                button.textContent = 'Delete reply';
                button.addEventListener('click', function () {
                    return remove('delete-reply', response.id,
                        'Permanently delete the reply from "' + response.name + '" for "' + response.event + '"? This cannot be undone.');
                });
                responses.children[responses.children.length - 1].appendChild(button);
            });
            cursor = data.cursor || '';
            more.hidden = !cursor;
            status(responses.children.length ? 'Responses loaded.' : 'No RSVPs yet.');
        } catch (error) {
            if (token !== session || version !== loadVersion) return;
            if (error.status === 401) logout();
            status(error.message || 'Unable to load responses. Please try again.', true);
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
                    return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
                }) : [];
            } catch (error) { cleanupJobs = []; }
            login.reset();
            login.hidden = true;
            actions.hidden = false;
            if (appearanceForm) appearanceForm.hidden = false;
            editor.hidden = false;
            eventsPanel.hidden = false;
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
