(function () {
    var TOKEN_KEY = 'mycard_sub_token';
    var EXPIRY_KEY = 'mycard_sub_expiry';
    var VIEWS = ['signin', 'forgot', 'reset', 'home'];

    function $(id) { return document.getElementById(id); }
    var params = new URLSearchParams(window.location.search);
    var urlToken = params.get('reset') || '';

    function message(text, ok) {
        var m = $('msg');
        m.textContent = text || '';
        m.className = 'msg' + (text ? (ok ? ' ok' : ' err') : '');
    }

    function show(view) {
        VIEWS.forEach(function (v) { $(v + 'View').hidden = v !== view; });
        $('intro').textContent = view === 'home' ? 'Your allocated cards.' :
            view === 'forgot' ? 'Reset your password' : view === 'reset' ? 'Choose your password' : 'Sign in to manage your cards.';
        message('');
    }

    function token() {
        var t = sessionStorage.getItem(TOKEN_KEY);
        if (!t || Number(sessionStorage.getItem(EXPIRY_KEY) || 0) <= Date.now()) { clearSession(); return null; }
        return t;
    }
    function clearSession() { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(EXPIRY_KEY); }

    async function api(payload, withSession) {
        var headers = { 'Content-Type': 'application/json' };
        if (withSession) headers['X-Sub-Session'] = token() || '';
        var resp = await fetch('/api/card-sub', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
        var data = {};
        try { data = await resp.json(); } catch (e) { /* empty body */ }
        if (withSession && resp.status === 401) { clearSession(); show('signin'); message('Your session has expired. Please sign in again.'); }
        return { ok: resp.ok && data.success, status: resp.status, data: data };
    }

    function cell(tr, text) {
        var td = document.createElement('td');
        td.style.padding = '6px 10px 6px 0';
        td.textContent = text;
        tr.appendChild(td);
    }

    async function loadHome() {
        show('home');
        var r = await api({ action: 'me' }, true);
        if (!r.ok) { if (r.status !== 401) message(r.data.error || 'Could not load your cards.'); return; }
        $('allowanceText').textContent = r.data.name + ' · ' + r.data.allocated + ' cards · ' + r.data.claimed + ' claimed · ' +
            (r.data.allocated - r.data.claimed) + ' unclaimed';
        var list = $('cardList');
        list.replaceChildren();
        if (!r.data.cards.length) { list.textContent = 'No cards allocated yet.'; return; }
        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.9rem;';
        r.data.cards.forEach(function (c) {
            var tr = document.createElement('tr');
            cell(tr, c.id);
            cell(tr, c.claimed ? 'Claimed' : 'Unclaimed');
            cell(tr, c.claimed ? (c.name || '(details not filled in yet)') : '');
            table.appendChild(tr);
        });
        list.appendChild(table);
    }

    $('signinForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        message('Signing in…', true);
        var r = await api({ action: 'login', email: $('siEmail').value, password: $('siPass').value });
        if (!r.ok) { message(r.data.error || 'Unable to sign in.'); return; }
        sessionStorage.setItem(TOKEN_KEY, r.data.sessionToken);
        sessionStorage.setItem(EXPIRY_KEY, String(r.data.expiresAt));
        $('signinForm').reset();
        loadHome();
    });

    $('forgotForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        await api({ action: 'forgot', email: $('fgEmail').value });
        $('forgotForm').reset();
        message('If that email has an account, we have sent a reset link. It expires in 30 minutes.', true);
    });

    $('resetForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var r = await api({ action: 'reset', token: urlToken, password: $('rsPass').value });
        if (!r.ok) { message(r.data.error || 'Unable to save your password.'); return; }
        $('resetForm').reset();
        history.replaceState(null, '', '/mycard/sub');
        urlToken = '';
        show('signin');
        message('Password saved. Please sign in.', true);
    });

    $('signOutBtn').addEventListener('click', async function () {
        await api({ action: 'logout' }, true);
        clearSession();
        show('signin');
    });

    document.querySelectorAll('[data-view]').forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); show(a.getAttribute('data-view')); });
    });

    if (urlToken) show('reset');
    else if (token()) loadHome();
    else show('signin');
})();
