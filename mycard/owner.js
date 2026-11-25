(function () {
    var TOKEN_KEY = 'mycard_owner_token';
    var ID_KEY = 'mycard_owner_id';
    var EXPIRY_KEY = 'mycard_owner_expiry';
    var VIEWS = ['signin', 'claim', 'forgot', 'reset', 'verify', 'edit'];

    var FIELDS = [
        ['name', 'Name *', 'text', true], ['title', 'Job title', 'text'], ['company', 'Company', 'text', true],
        ['companyLogoUrl', 'Company logo image URL', 'url', true], ['companyLogoLinkUrl', 'Company logo link', 'url', true],
        ['bio', 'About / Bio', 'textarea', true], ['photoUrl', 'Photo URL (https)', 'url', true],
        ['phone', 'Phone', 'text'], ['whatsapp', 'WhatsApp (number or wa.me link)', 'text'],
        ['email', 'Email shown on card', 'text'], ['website', 'Website', 'url'], ['mapUrl', 'Address / Google Maps link', 'url', true],
        ['facebook', 'Facebook', 'url'], ['instagram', 'Instagram', 'url'], ['tiktok', 'TikTok', 'url'],
        ['linkedin', 'LinkedIn', 'url'], ['twitter', 'X / Twitter', 'url'],
        ['customLabel', 'Custom link label', 'text'], ['customUrl', 'Custom link URL', 'url']
    ];

    function $(id) { return document.getElementById(id); }
    var params = new URLSearchParams(window.location.search);
    var urlToken = params.get('verify') || params.get('reset') || '';

    function message(text, ok) {
        var m = $('msg');
        m.textContent = text || '';
        m.className = 'msg' + (text ? (ok ? ' ok' : ' err') : '');
    }

    function show(view) {
        VIEWS.forEach(function (v) { $(v + 'View').hidden = v !== view; });
        $('main').className = view === 'edit' ? 'wide' : '';
        $('intro').textContent = view === 'edit' ? 'Edit your card details below.' :
            view === 'claim' ? 'Claim your card' : view === 'forgot' ? 'Reset your password' :
            view === 'reset' ? 'Choose a new password' : view === 'verify' ? 'Almost done' : 'Sign in to edit your card.';
        message('');
    }

    async function api(path, payload, headers) {
        var resp = await fetch(path, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
            body: JSON.stringify(payload)
        });
        var data = {};
        try { data = await resp.json(); } catch (e) { /* empty body */ }
        return { ok: resp.ok && data.success, status: resp.status, data: data };
    }

    function session() {
        var token = sessionStorage.getItem(TOKEN_KEY);
        var expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
        if (!token || expiry <= Date.now()) { clearSession(); return null; }
        return { token: token, id: sessionStorage.getItem(ID_KEY) };
    }
    function clearSession() { [TOKEN_KEY, ID_KEY, EXPIRY_KEY].forEach(function (k) { sessionStorage.removeItem(k); }); }

    // Fields are built once; values are filled in after loading the card.
    function buildFields() {
        var host = $('fields');
        FIELDS.forEach(function (f) {
            var wrap = document.createElement('div');
            if (f[2] === 'textarea' || f[3]) wrap.className = 'full';
            var label = document.createElement('label');
            label.htmlFor = 'f_' + f[0];
            label.textContent = f[1];
            var input = document.createElement(f[2] === 'textarea' ? 'textarea' : 'input');
            if (f[2] !== 'textarea') input.type = f[2] === 'url' ? 'text' : f[2];
            input.id = 'f_' + f[0];
            input.autocomplete = 'off';
            if (f[0] === 'bio') input.maxLength = 1000;
            wrap.appendChild(label);
            wrap.appendChild(input);
            host.appendChild(wrap);
        });
        var accent = document.createElement('div');
        accent.className = 'full';
        var label = document.createElement('label');
        label.htmlFor = 'f_accentColor';
        label.textContent = 'Accent colour';
        var color = document.createElement('input');
        color.type = 'color';
        color.id = 'f_accentColor';
        color.value = '#00adb5';
        var useLabel = document.createElement('label');
        useLabel.style.display = 'inline';
        useLabel.style.marginLeft = '12px';
        var use = document.createElement('input');
        use.type = 'checkbox';
        use.id = 'useAccent';
        useLabel.appendChild(use);
        useLabel.appendChild(document.createTextNode(' Use this colour'));
        accent.appendChild(label);
        accent.appendChild(color);
        accent.appendChild(useLabel);
        color.addEventListener('input', function () { use.checked = true; });
        host.appendChild(accent);
    }

    function fill(content) {
        content = content || {};
        FIELDS.forEach(function (f) { $('f_' + f[0]).value = content[f[0]] || ''; });
        $('useAccent').checked = !!content.accentColor;
        if (content.accentColor) $('f_accentColor').value = content.accentColor;
    }

    async function openEditor(s) {
        show('edit');
        $('viewCardLink').href = '/mycard/?id=' + encodeURIComponent(s.id);
        message('Loading…', true);
        var r = await api('/api/card-content', { action: 'get-content', id: s.id }, { 'X-Owner-Session': s.token });
        if (r.status === 401) { clearSession(); show('signin'); message('Your session has expired. Please sign in again.'); return; }
        if (!r.ok) { message(r.data.error || 'Could not load your card.'); return; }
        fill(r.data.content);
        message('');
    }

    $('signinForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        message('Signing in…', true);
        var r = await api('/api/card-owner', { action: 'login', id: $('siId').value, password: $('siPass').value });
        if (!r.ok) { message(r.data.error || 'Unable to sign in.'); return; }
        sessionStorage.setItem(TOKEN_KEY, r.data.sessionToken);
        sessionStorage.setItem(ID_KEY, r.data.id);
        sessionStorage.setItem(EXPIRY_KEY, String(r.data.expiresAt));
        $('signinForm').reset();
        openEditor({ token: r.data.sessionToken, id: r.data.id });
    });

    $('claimForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        message('Sending…', true);
        var r = await api('/api/card-owner', { action: 'claim', id: $('clId').value, code: $('clCode').value,
            email: $('clEmail').value, password: $('clPass').value });
        if (!r.ok) { message(r.data.error || 'Unable to claim this card.'); return; }
        $('claimForm').reset();
        message('Check your email and click the confirmation link to finish.', true);
    });

    $('forgotForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        await api('/api/card-owner', { action: 'forgot', id: $('fgId').value, email: $('fgEmail').value });
        $('forgotForm').reset();
        message('If those details match, we have emailed a reset link. It expires in 30 minutes.', true);
    });

    $('resetForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var r = await api('/api/card-owner', { action: 'reset', token: urlToken, password: $('rsPass').value });
        if (!r.ok) { message(r.data.error || 'Unable to reset your password.'); return; }
        $('resetForm').reset();
        history.replaceState(null, '', '/mycard/owner');
        urlToken = '';
        show('signin');
        $('siId').value = r.data.id || '';
        message('Password updated. Please sign in.', true);
    });

    $('verifyBtn').addEventListener('click', async function () {
        var r = await api('/api/card-owner', { action: 'verify-email', token: urlToken });
        if (!r.ok) { message(r.data.error || 'Unable to confirm your email.'); return; }
        history.replaceState(null, '', '/mycard/owner');
        urlToken = '';
        show('signin');
        $('siId').value = r.data.id || '';
        message('Email confirmed. Sign in with your password.', true);
    });

    $('editForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var s = session();
        if (!s) { show('signin'); message('Your session has expired. Please sign in again.'); return; }
        var payload = { action: 'set-content', id: s.id };
        FIELDS.forEach(function (f) { payload[f[0]] = $('f_' + f[0]).value.trim(); });
        payload.accentColor = $('useAccent').checked ? $('f_accentColor').value : '';
        message('Saving…', true);
        var r = await api('/api/card-content', payload, { 'X-Owner-Session': s.token });
        if (r.status === 401) { clearSession(); show('signin'); message('Your session has expired. Please sign in again.'); return; }
        message(r.ok ? 'Saved.' : (r.data.error || 'Could not save.'), r.ok);
    });

    $('signOutBtn').addEventListener('click', async function () {
        var s = session();
        if (s) await api('/api/card-owner', { action: 'logout' }, { 'X-Owner-Session': s.token });
        clearSession();
        show('signin');
    });

    document.querySelectorAll('[data-view]').forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); show(a.getAttribute('data-view')); });
    });

    buildFields();
    var existing = session();
    if (params.get('reset') && urlToken) show('reset');
    else if (params.get('verify') && urlToken) show('verify');
    else if (existing) openEditor(existing);
    else {
        show(params.get('claim') ? 'claim' : 'signin');
        if (params.get('id')) { $('siId').value = params.get('id'); $('clId').value = params.get('id'); $('fgId').value = params.get('id'); }
    }
})();
