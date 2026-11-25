(function () {
    var form = document.getElementById('loginForm');
    var sections = document.getElementById('sections');
    var msg = document.getElementById('msg');
    var info = document.getElementById('info');

    // Each admin page keeps its own sessionStorage keys; fill them all from one login.
    function shareSession(token, expiresAt) {
        var until = String(expiresAt);
        var items = {
            adminSessionToken: token,
            mycard_admin_token: token, mycard_admin_authed: 'yes', mycard_admin_authed_until: until,
            memorials_admin_token: token, memorials_admin_expiry: until,
            foreverpets_admin_token: token, foreverpets_admin_authed: 'yes', foreverpets_admin_authed_until: until
        };
        Object.keys(items).forEach(function (key) { sessionStorage.setItem(key, items[key]); });
    }

    function clearSession() {
        ['adminSessionToken', 'mycard_admin_token', 'mycard_admin_authed', 'mycard_admin_authed_until',
            'memorials_admin_token', 'memorials_admin_expiry',
            'foreverpets_admin_token', 'foreverpets_admin_authed', 'foreverpets_admin_authed_until'
        ].forEach(function (key) { sessionStorage.removeItem(key); });
    }

    async function post(path, payload, token) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-Admin-Session'] = token;
        var resp = await fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
        var data = await resp.json().catch(function () { return {}; });
        if (!resp.ok || !data.success) throw new Error(data.error || 'Request failed');
        return data;
    }

    function show(signedIn, expiresAt) {
        form.hidden = signedIn;
        sections.hidden = !signedIn;
        if (signedIn) info.textContent = 'Signed in until ' + new Date(expiresAt).toLocaleTimeString() + '.';
    }

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var button = form.querySelector('button');
        button.disabled = true;
        msg.textContent = '';
        try {
            var login = await post('/api/password', {
                action: 'verify', id: '__admin__', password: document.getElementById('password').value
            });
            if (!login.sessionToken) throw new Error('Admin session could not be started.');
            await post('/api/admin-session', { action: 'start' }, login.sessionToken);
            shareSession(login.sessionToken, login.expiresAt);
            form.reset();
            show(true, login.expiresAt);
        } catch (error) {
            msg.textContent = error.message === 'Request failed' ? 'Unable to sign in.' : error.message;
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById('logout').addEventListener('click', async function () {
        clearSession();
        try { await post('/api/admin-session', { action: 'end' }); } catch (error) { /* Cookie expires on its own. */ }
        show(false);
    });

    var token = sessionStorage.getItem('adminSessionToken');
    var until = Number(sessionStorage.getItem('mycard_admin_authed_until') || 0);
    if (token && until > Date.now()) show(true, until);
})();
