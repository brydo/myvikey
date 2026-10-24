(function () {
    'use strict';
    var message = document.getElementById('message');
    var receiptKey = 'rsvp_receipt';

    function status(text, error) {
        message.textContent = text;
        message.classList.toggle('error', !!error);
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
            status('Opening your invitation…');
            post('/api/rsvp', { action: 'get-invitation', id: eventId }).then(function (data) {
                invitation = data.invitation;
                document.getElementById('heading').textContent = invitation.title;
                document.getElementById('invitationText').textContent = invitation.text;
                document.getElementById('invitationHelp').hidden = true;
                form.elements.event.value = invitation.title;
                form.querySelector('button').disabled = false;
                openRsvp.hidden = false;
                status('');
            }).catch(function (error) { status(error.message, true); });
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
                status('Thanks, your RSVP is saved. No external message has been sent.');
                window.RSVP.sendOptions(document.getElementById('sendOptions'), data.response, data.organiser);
                try {
                    sessionStorage.setItem(receiptKey, JSON.stringify({
                        response: data.response, organiser: data.organiser
                    }));
                    window.location.assign('/rsvp/view');
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
        try {
            var saved = JSON.parse(sessionStorage.getItem(receiptKey));
            if (saved) {
                var reply = saved.response || saved;
                window.RSVP.render(receipt, reply);
                window.RSVP.sendOptions(document.getElementById('sendOptions'), reply, saved.organiser);
                document.getElementById('receiptHeading').textContent = 'Thank you!';
                status('Thanks, your RSVP is saved on this site.');
                if (reply.eventId) {
                    document.querySelector('nav a').href = '/rsvp/?id=' + encodeURIComponent(reply.eventId);
                }
            }
        } catch (error) {
            status('Your confirmation is unavailable in this tab. If you already submitted, your RSVP is still recorded.');
        }
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

    function showInvitation(invitation) {
        ['id', 'title', 'text', 'whatsapp', 'email'].forEach(function (field) {
            editor.elements[field].value = invitation[field] || '';
        });
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
        var payload = { action: 'save-invitation' };
        ['title', 'text', 'whatsapp', 'email'].forEach(function (field) {
            payload[field] = editor.elements[field].value.trim();
        });
        if (editor.elements.id.value.trim()) payload.id = editor.elements.id.value.trim();
        try {
            var data = await post('/api/rsvp', payload, session);
            if (token !== session) return;
            showInvitation(data.invitation);
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
        share.replaceChildren();
        status('New invitation. Save to create a separate share link.');
    });

    function logout() {
        token = '';
        cursor = '';
        responses.replaceChildren();
        login.hidden = false;
        actions.hidden = true;
        more.hidden = true;
        editor.hidden = true;
        editor.reset();
        share.replaceChildren();
        status('');
    }

    async function load(append) {
        var session = token;
        more.disabled = true;
        document.getElementById('refresh').disabled = true;
        if (!append) {
            cursor = '';
            responses.replaceChildren();
        }
        more.hidden = true;
        status('Loading responses…');
        try {
            var data = await post('/api/rsvp', { action: 'list', cursor: cursor }, token);
            if (token !== session) return;
            data.responses.forEach(function (response) { window.RSVP.render(responses, response); });
            cursor = data.cursor || '';
            more.hidden = !cursor;
            status(responses.children.length ? 'Responses loaded.' : 'No RSVPs yet.');
        } catch (error) {
            if (token !== session) return;
            if (error.status === 401) logout();
            status(error.message || 'Unable to load responses. Please try again.', true);
        } finally {
            more.disabled = false;
            document.getElementById('refresh').disabled = false;
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
            login.reset();
            login.hidden = true;
            actions.hidden = false;
            editor.hidden = false;
            await load(false);
        } catch (error) {
            status(error.message || 'Unable to sign in. Please try again.', true);
        } finally {
            button.disabled = false;
        }
    });
    document.getElementById('logout').addEventListener('click', logout);
    document.getElementById('refresh').addEventListener('click', function () { load(false); });
    more.addEventListener('click', function () { load(true); });
})();
