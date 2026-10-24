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
        var attending = form.elements.attending;
        var guests = form.elements.guests;
        attending.addEventListener('change', function () {
            guests.disabled = attending.value === 'no';
            if (guests.disabled) guests.value = '0';
        });
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            var button = form.querySelector('button');
            button.disabled = true;
            status('Sending…');
            var response = {
                name: form.elements.name.value.trim(),
                event: form.elements.event.value.trim(),
                attending: attending.value,
                guests: Number(guests.value),
                notes: form.elements.notes.value.trim()
            };
            try {
                await post('/api/rsvp', Object.assign({ action: 'submit' }, response));
                status('Thanks, your RSVP is recorded.');
                form.reset();
                guests.disabled = false;
                try {
                    sessionStorage.setItem(receiptKey, JSON.stringify(response));
                    window.location.assign('/rsvp/view');
                } catch (storageError) {
                    // The response is saved even when browser storage is unavailable.
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
                window.RSVP.render(receipt, saved);
                document.getElementById('receiptHeading').textContent = 'Thank you!';
                status('Thanks, your RSVP is recorded.');
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

    function logout() {
        token = '';
        cursor = '';
        responses.replaceChildren();
        login.hidden = false;
        actions.hidden = true;
        more.hidden = true;
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
