(function () {
    var TOKEN_KEY = 'mycard_sub_token';
    var EXPIRY_KEY = 'mycard_sub_expiry';
    var VIEWS = ['signin', 'forgot', 'reset', 'home'];
    var lastCsv = '';

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
        $('intro').textContent = view === 'home' ? 'Create cards and see which have been claimed.' :
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

    function cell(tr, text, bold) {
        var td = document.createElement('td');
        td.style.padding = '6px 10px 6px 0';
        if (bold) { var b = document.createElement('b'); b.textContent = text; td.appendChild(b); } else td.textContent = text;
        tr.appendChild(td);
    }

    async function loadHome() {
        show('home');
        var r = await api({ action: 'me' }, true);
        if (!r.ok) { if (r.status !== 401) message(r.data.error || 'Could not load your cards.'); return; }
        var left = Math.max(0, r.data.allowance - r.data.used);
        $('allowanceText').textContent = r.data.name + ' · ' + r.data.used + ' of ' + r.data.allowance + ' cards used · ' + left + ' left';
        var list = $('cardList');
        list.replaceChildren();
        if (!r.data.cards.length) { list.textContent = 'No cards yet.'; return; }
        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.9rem;';
        r.data.cards.forEach(function (c) {
            var tr = document.createElement('tr');
            cell(tr, c.id);
            cell(tr, c.claimed ? 'Claimed' : 'Unclaimed');
            var td = document.createElement('td');
            if (!c.claimed) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'secondary';
                b.style.cssText = 'margin:0;padding:6px 10px;font-size:0.85rem;';
                b.textContent = 'New code';
                b.addEventListener('click', function () { reissue(c); });
                td.appendChild(b);
            }
            tr.appendChild(td);
            table.appendChild(tr);
        });
        list.appendChild(table);
    }

    async function reissue(c) {
        var r = await api({ action: 'reissue', id: c.id }, true);
        if (!r.ok) { if (r.status !== 401) message(r.data.error || 'Could not issue a new code.'); return; }
        showCodes([{ id: c.id, url: c.url, code: r.data.code }], 'New code for ' + c.id + ' (the old code no longer works):');
    }

    function showCodes(cards, title) {
        var host = $('newCodes');
        host.replaceChildren();
        var h = document.createElement('p');
        h.textContent = title;
        host.appendChild(h);
        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.9rem;';
        cards.forEach(function (c) {
            var tr = document.createElement('tr');
            cell(tr, c.id); cell(tr, c.url); cell(tr, c.code, true);
            table.appendChild(tr);
        });
        host.appendChild(table);
        lastCsv = 'Card ID,URL,Claim code\n' + cards.map(function (c) { return [c.id, c.url, c.code].join(','); }).join('\n') + '\n';
        $('csvBtn').hidden = false;
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

    $('batchForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var count = Number($('batchCount').value);
        message('Creating…', true);
        var r = await api({ action: 'create-batch', count: count }, true);
        if (!r.ok) { if (r.status !== 401) message(r.data.error || 'Could not create cards.'); return; }
        showCodes(r.data.cards, r.data.cards.length + ' new card(s). ' + (r.data.emailed ? 'Also emailed to you.' : 'The email could not be sent, so save these now.'));
        message('');
        loadHomeQuiet();
    });

    async function loadHomeQuiet() {
        var keep = $('newCodes').cloneNode(true);
        await loadHome();
        $('newCodes').replaceWith(keep);
        keep.id = 'newCodes';
        $('csvBtn').hidden = !lastCsv;
    }

    $('csvBtn').addEventListener('click', function () {
        var url = URL.createObjectURL(new Blob([lastCsv], { type: 'text/csv' }));
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mycard-cards.csv';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    $('signOutBtn').addEventListener('click', async function () {
        await api({ action: 'logout' }, true);
        clearSession();
        lastCsv = '';
        $('newCodes').replaceChildren();
        show('signin');
    });

    document.querySelectorAll('[data-view]').forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); show(a.getAttribute('data-view')); });
    });

    if (urlToken) show('reset');
    else if (token()) loadHome();
    else show('signin');
})();
