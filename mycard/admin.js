/* MyCard admin. All dynamic content is rendered with DOM APIs / textContent. */
(function () {
    'use strict';
    var ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;
    var ADMIN_SESSION_KEY = 'mycard_admin_token';
    var ADMIN_AUTH_KEY = 'mycard_admin_authed';
    var ADMIN_EXPIRY_KEY = 'mycard_admin_authed_until';

    var TEXT_FIELDS = ['name', 'title', 'company', 'bio', 'photoUrl', 'phone', 'whatsapp', 'email', 'website', 'mapUrl',
        'facebook', 'instagram', 'tiktok', 'linkedin', 'twitter', 'youtube', 'telegram', 'customLabel', 'customUrl'];

    var currentPhotoPosition = '50% 50%';
    var positionKnown = false;
    var dragHandlersAttached = false;
    var previewTimer = null;

    function $(id) { return document.getElementById(id); }

    /* Attach the admin session header to /api/card-* calls */
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
        opts = opts || {};
        if (typeof url === 'string' && url.indexOf('/api/card-') === 0) {
            var token = sessionStorage.getItem(ADMIN_SESSION_KEY);
            if (token) opts.headers = Object.assign({}, opts.headers || {}, { 'X-Admin-Session': token });
        }
        return originalFetch(url, opts);
    };

    async function safeJson(resp) {
        var text = await resp.text();
        if (!text) return {};
        try { return JSON.parse(text); }
        catch (e) { return { error: 'Invalid JSON response (status ' + resp.status + ')' }; }
    }

    async function api(path, payload) {
        var resp = await fetch(path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var data = await safeJson(resp);
        if (resp.status === 401 && payload.action !== 'verify') {
            data.error = 'Session expired or unauthorised. Please log in again.';
        }
        return { ok: resp.ok && data.success, status: resp.status, data: data };
    }

    function setMsg(id, text, ok) {
        var m = $(id);
        m.textContent = text;
        m.className = 'msg ' + (ok ? 'ok' : 'err');
    }

    /* ===== Session ===== */
    function isAdminSessionValid() {
        var authed = sessionStorage.getItem(ADMIN_AUTH_KEY) === 'yes';
        var expiresAt = Number(sessionStorage.getItem(ADMIN_EXPIRY_KEY) || 0);
        return authed && Number.isFinite(expiresAt) && expiresAt > Date.now();
    }
    function refreshAdminSession() {
        if (sessionStorage.getItem(ADMIN_AUTH_KEY) === 'yes') {
            sessionStorage.setItem(ADMIN_EXPIRY_KEY, String(Date.now() + ADMIN_SESSION_TTL_MS));
        }
    }
    function bindAdminSessionTimeout() {
        ['mousemove', 'keydown', 'click', 'touchstart'].forEach(function (name) {
            document.addEventListener(name, function () { if (isAdminSessionValid()) refreshAdminSession(); });
        });
        setInterval(function () {
            if (sessionStorage.getItem(ADMIN_AUTH_KEY) === 'yes' && !isAdminSessionValid()) logout();
        }, 30000);
    }

    async function login() {
        var pass = $('adminPass').value.trim();
        if (!pass) { setMsg('loginMsg', 'Please enter a password.', false); return; }
        $('loginMsg').textContent = 'Checking…';
        $('loginMsg').className = 'msg';
        try {
            /* Same shared admin (__admin__) login used by the memorial / pet admin pages */
            var r = await api('/api/password', { action: 'verify', id: '__admin__', password: pass });
            if (r.ok) {
                if (r.data.sessionToken) sessionStorage.setItem(ADMIN_SESSION_KEY, r.data.sessionToken);
                sessionStorage.setItem(ADMIN_AUTH_KEY, 'yes');
                sessionStorage.setItem(ADMIN_EXPIRY_KEY, String(Date.now() + ADMIN_SESSION_TTL_MS));
                showAdmin();
            } else {
                setMsg('loginMsg', r.status === 429 ? '✗ ' + (r.data.error || 'Too many attempts.') : '✗ Incorrect password.', false);
                $('adminPass').value = '';
                $('adminPass').focus();
            }
        } catch (e) { setMsg('loginMsg', '✗ Error: ' + e.message, false); }
    }

    function showAdmin() {
        if (!isAdminSessionValid()) { logout(); return; }
        refreshAdminSession();
        $('loginScreen').style.display = 'none';
        $('adminPanel').style.display = 'block';
        schedulePreview();
        listCards();
    }

    function logout() {
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
        sessionStorage.removeItem(ADMIN_AUTH_KEY);
        sessionStorage.removeItem(ADMIN_EXPIRY_KEY);
        $('adminPanel').style.display = 'none';
        $('loginScreen').style.display = 'block';
        $('adminPass').value = '';
        $('adminPass').focus();
    }

    /* ===== Form <-> data ===== */
    function safeId() { return $('cardId').value.trim(); }
    function cardUrl(id) { return window.location.origin + '/mycard/?id=' + encodeURIComponent(id); }
    function updateNfcUrl() { $('nfcUrl').value = safeId() ? cardUrl(safeId()) : ''; }

    function collect() {
        var c = {};
        TEXT_FIELDS.forEach(function (f) { c[f] = $('f_' + f).value.trim(); });
        c.accentColor = $('useAccent').checked ? $('f_accentColor').value : '';
        c.photoPosition = currentPhotoPosition;
        return c;
    }

    function fill(c) {
        TEXT_FIELDS.forEach(function (f) { $('f_' + f).value = c[f] || ''; });
        var hasAccent = MyCard.validHex(c.accentColor || '');
        $('useAccent').checked = hasAccent;
        $('f_accentColor').value = hasAccent ? c.accentColor : '#c9a96e';
    }

    function schedulePreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
            MyCard.render($('previewRoot'), collect(), { url: cardUrl(safeId() || 'preview') });
        }, 150);
    }

    /* ===== Photo positioning ===== */
    function updatePhotoPreview() {
        var img = document.querySelector('#photoPreviewCircle img');
        if (img) img.style.objectPosition = currentPhotoPosition;
        var parts = currentPhotoPosition.split(' ');
        var x = parseInt(parts[0], 10); var y = parseInt(parts[1], 10);
        if (!Number.isFinite(x)) x = 50;
        if (!Number.isFinite(y)) y = 50;
        $('posXSlider').value = x;
        $('posYSlider').value = y;
        $('posXVal').textContent = x + '%';
        $('posYVal').textContent = y + '%';
        schedulePreview();
    }

    function buildPhotoPreview(url) {
        var section = $('photoPositionSection');
        var circle = $('photoPreviewCircle');
        url = MyCard.safeUrl(url);
        if (!url) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        var ph = document.createElement('div');
        ph.className = 'photo-preview-placeholder';
        ph.textContent = 'Loading…';
        circle.replaceChildren(ph);
        var img = new Image();
        img.alt = 'Photo position preview';
        img.onload = function () {
            img.style.objectPosition = currentPhotoPosition;
            circle.replaceChildren(img);
            updatePhotoPreview();
            attachDragHandlers();
        };
        img.onerror = function () {
            var e = document.createElement('div');
            e.className = 'photo-preview-placeholder';
            e.textContent = '⚠️';
            circle.replaceChildren(e);
        };
        img.src = url;
    }

    function resetPhotoPosition() {
        currentPhotoPosition = '50% 50%';
        positionKnown = true;
        updatePhotoPreview();
    }

    function attachDragHandlers() {
        if (dragHandlersAttached) return;
        dragHandlersAttached = true;
        var circle = $('photoPreviewCircle');
        var dragging = false;
        function setFrom(cx, cy) {
            var rect = circle.getBoundingClientRect();
            var x = Math.max(0, Math.min(100, Math.round(((cx - rect.left) / rect.width) * 100)));
            var y = Math.max(0, Math.min(100, Math.round(((cy - rect.top) / rect.height) * 100)));
            currentPhotoPosition = x + '% ' + y + '%';
            positionKnown = true;
            updatePhotoPreview();
        }
        function onDown(e) {
            if (!circle.querySelector('img')) return;
            dragging = true;
            e.preventDefault();
            var pt = e.touches ? e.touches[0] : e;
            setFrom(pt.clientX, pt.clientY);
        }
        function onMove(e) {
            if (!dragging) return;
            e.preventDefault();
            var pt = e.touches ? e.touches[0] : e;
            setFrom(pt.clientX, pt.clientY);
        }
        function onUp() { dragging = false; }
        circle.addEventListener('mousedown', onDown);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        circle.addEventListener('touchstart', onDown, { passive: false });
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    }

    /* ===== Card actions ===== */
    async function saveCard() {
        var id = safeId();
        if (!id) { setMsg('contentMsg', 'Please enter a page ID.', false); return; }
        var c = collect();
        if (!c.name) { setMsg('contentMsg', 'Please enter a name.', false); return; }
        var payload = Object.assign({ action: 'set-content', id: id }, c);
        if (!positionKnown) delete payload.photoPosition; /* keep the saved position */
        try {
            var r = await api('/api/card-content', payload);
            if (r.ok) setMsg('contentMsg', '✓ Card saved for "' + id + '". View: ' + cardUrl(id), true);
            else setMsg('contentMsg', '✗ ' + (r.data.error || 'Failed'), false);
            if (r.ok) listCards();
        } catch (e) { setMsg('contentMsg', '✗ Error: ' + e.message, false); }
    }

    async function loadCard(idOverride) {
        var id = idOverride || safeId();
        if (!id) { setMsg('contentMsg', 'Please enter a page ID.', false); return; }
        if (idOverride) {
            $('cardId').value = idOverride;
            updateNfcUrl();
        }
        try {
            var r = await api('/api/card-content', { action: 'get-content', id: id });
            if (!r.ok) { setMsg('contentMsg', '✗ ' + (r.data.error || 'Failed'), false); return; }
            if (!r.data.content) { setMsg('contentMsg', 'No card exists for "' + id + '" yet. Fill in the form and save to create it.', false); return; }
            var c = r.data.content;
            fill(c);
            currentPhotoPosition = MyCard.validPosition(c.photoPosition);
            positionKnown = true;
            updatePhotoPreview();
            buildPhotoPreview(c.photoUrl || '');
            schedulePreview();
            setMsg('contentMsg', '✓ Loaded card "' + id + '".', true);
        } catch (e) { setMsg('contentMsg', '✗ Error: ' + e.message, false); }
    }

    function clearForm() {
        fill({});
        $('cardId').value = '';
        updateNfcUrl();
        currentPhotoPosition = '50% 50%';
        positionKnown = false;
        $('photoPositionSection').style.display = 'none';
        updatePhotoPreview();
        $('contentMsg').textContent = '';
    }

    async function deleteCard() {
        var id = safeId();
        if (!id) { setMsg('deleteMsg', 'Please enter a page ID.', false); return; }
        if (!confirm('Delete ALL data for "' + id + '"? This cannot be undone.')) return;
        try {
            var r = await api('/api/card-content', { action: 'delete-content', id: id });
            if (!r.ok) { setMsg('deleteMsg', '✗ ' + (r.data.error || 'Failed'), false); return; }
            var p = await api('/api/card-password', { action: 'delete', id: id });
            if (p.ok) setMsg('deleteMsg', '✓ All data deleted for "' + id + '".', true);
            else setMsg('deleteMsg', '⚠ Card deleted, but password removal failed: ' + (p.data.error || 'Failed'), false);
            listCards();
        } catch (e) { setMsg('deleteMsg', '✗ Error: ' + e.message, false); }
    }

    async function setPassword() {
        var id = safeId();
        var pass = $('setPass').value.trim();
        if (!id || !pass) { setMsg('passMsg', 'Please enter the Page ID and a password.', false); return; }
        try {
            var r = await api('/api/card-password', { action: 'set', id: id, password: pass });
            if (r.ok) { setMsg('passMsg', '✓ Password set for "' + id + '".', true); $('setPass').value = ''; }
            else setMsg('passMsg', '✗ ' + (r.data.error || 'Failed'), false);
        } catch (e) { setMsg('passMsg', '✗ Error: ' + e.message, false); }
    }

    async function deletePassword() {
        var id = safeId();
        if (!id) { setMsg('passMsg', 'Please enter a page ID.', false); return; }
        try {
            var r = await api('/api/card-password', { action: 'delete', id: id });
            if (r.ok) setMsg('passMsg', '✓ Password removed for "' + id + '".', true);
            else setMsg('passMsg', '✗ ' + (r.data.error || 'Failed'), false);
        } catch (e) { setMsg('passMsg', '✗ Error: ' + e.message, false); }
    }

    async function copyUrl(id, btn) {
        var url = cardUrl(id);
        var original = btn.textContent;
        try {
            await navigator.clipboard.writeText(url);
            btn.textContent = 'Copied!';
        } catch (e) {
            btn.textContent = 'Copy failed';
            setMsg('listMsg', url, true);
        }
        setTimeout(function () { btn.textContent = original; }, 1500);
    }

    async function copyNfcUrl() {
        var id = safeId();
        if (!id) { setMsg('nfcMsg', 'Enter a Page ID to create its NFC URL.', false); return; }
        var btn = $('copyNfcUrlBtn');
        var original = btn.textContent;
        try {
            await navigator.clipboard.writeText(cardUrl(id));
            setMsg('nfcMsg', 'NFC URL copied to clipboard.', true);
            btn.textContent = 'Copied!';
        } catch (e) {
            setMsg('nfcMsg', 'Copy failed. Select and copy the URL above.', false);
            btn.textContent = 'Copy failed';
        }
        setTimeout(function () { btn.textContent = original; }, 1500);
    }

    async function listCards() {
        var listEl = $('pageList');
        function status(text) {
            var d = document.createElement('div');
            d.style.color = 'var(--text-muted)';
            d.textContent = text;
            listEl.replaceChildren(d);
        }
        status('Loading…');
        try {
            var r = await api('/api/card-content', { action: 'list-content' });
            if (!r.ok) { status(''); setMsg('listMsg', '✗ ' + (r.data.error || 'Failed'), false); return; }
            $('listMsg').textContent = '';
            if (!r.data.pages.length) { status('No cards yet.'); return; }
            var items = r.data.pages.map(function (p) {
                var item = document.createElement('div');
                item.className = 'page-list-item';
                var top = document.createElement('div');
                var idEl = document.createElement('span');
                idEl.className = 'id';
                idEl.textContent = p.id;
                top.appendChild(idEl);
                var nm = document.createElement('span');
                nm.className = 'dob';
                nm.textContent = [p.name, p.title].filter(Boolean).join(' · ');
                top.appendChild(nm);
                item.appendChild(top);

                var actions = document.createElement('div');
                actions.className = 'list-actions';
                var view = document.createElement('a');
                view.href = '/mycard/?id=' + encodeURIComponent(p.id);
                view.target = '_blank';
                view.rel = 'noopener noreferrer';
                view.textContent = 'View';
                var edit = document.createElement('button');
                edit.type = 'button';
                edit.className = 'secondary';
                edit.textContent = 'Edit';
                edit.addEventListener('click', function () { loadCard(p.id); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                var copy = document.createElement('button');
                copy.type = 'button';
                copy.className = 'secondary';
                copy.textContent = 'Copy NFC URL';
                copy.addEventListener('click', function () { copyUrl(p.id, copy); });
                actions.appendChild(view);
                actions.appendChild(edit);
                actions.appendChild(copy);
                item.appendChild(actions);
                return item;
            });
            listEl.replaceChildren.apply(listEl, items);
        } catch (e) { status(''); setMsg('listMsg', '✗ Error: ' + e.message, false); }
    }

    /* ===== Wiring ===== */
    $('loginBtn').addEventListener('click', login);
    $('adminPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
    $('logoutBtn').addEventListener('click', logout);
    $('saveBtn').addEventListener('click', saveCard);
    $('loadBtn').addEventListener('click', function () { loadCard(); });
    $('newBtn').addEventListener('click', clearForm);
    $('deleteBtn').addEventListener('click', deleteCard);
    $('setPassBtn').addEventListener('click', setPassword);
    $('delPassBtn').addEventListener('click', deletePassword);
    $('listBtn').addEventListener('click', listCards);
    $('copyNfcUrlBtn').addEventListener('click', copyNfcUrl);
    $('resetPosBtn').addEventListener('click', resetPhotoPosition);

    ['posXSlider', 'posYSlider'].forEach(function (id) {
        $(id).addEventListener('input', function () {
            currentPhotoPosition = $('posXSlider').value + '% ' + $('posYSlider').value + '%';
            positionKnown = true;
            updatePhotoPreview();
        });
    });
    $('cardId').addEventListener('input', function () {
        updateNfcUrl();
        currentPhotoPosition = '50% 50%';
        positionKnown = false;
        updatePhotoPreview();
    });
    $('f_photoUrl').addEventListener('input', function () { buildPhotoPreview(this.value.trim()); schedulePreview(); });
    TEXT_FIELDS.forEach(function (f) { if (f !== 'photoUrl') $('f_' + f).addEventListener('input', schedulePreview); });
    $('f_accentColor').addEventListener('input', function () { $('useAccent').checked = true; schedulePreview(); });
    $('useAccent').addEventListener('change', schedulePreview);
    updateNfcUrl();

    if (sessionStorage.getItem(ADMIN_AUTH_KEY) === 'yes') {
        if (isAdminSessionValid()) showAdmin(); else logout();
    }
    bindAdminSessionTimeout();
})();
