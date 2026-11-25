/* MyCard admin. All dynamic content is rendered with DOM APIs / textContent. */
(function () {
    'use strict';
    var ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;
    var ADMIN_SESSION_KEY = 'mycard_admin_token';
    var ADMIN_AUTH_KEY = 'mycard_admin_authed';
    var ADMIN_EXPIRY_KEY = 'mycard_admin_authed_until';

    var TEXT_FIELDS = ['name', 'title', 'company', 'bio', 'photoUrl', 'companyLogoUrl', 'companyLogoLinkUrl', 'phone', 'whatsapp', 'email', 'website', 'mapUrl',
        'facebook', 'instagram', 'tiktok', 'linkedin', 'twitter', 'customLabel', 'customUrl'];

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
        try {
            var data = JSON.parse(text);
            return data && typeof data === 'object' ? data : {};
        }
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
        if (!m) return;
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
            if (r.ok && r.data.sessionToken) {
                sessionStorage.setItem(ADMIN_SESSION_KEY, r.data.sessionToken);
                sessionStorage.setItem(ADMIN_AUTH_KEY, 'yes');
                sessionStorage.setItem(ADMIN_EXPIRY_KEY, String(Date.now() + ADMIN_SESSION_TTL_MS));
                showAdmin();
            } else {
                var message = r.status === 429 ? (r.data.error || 'Too many attempts.')
                    : r.ok ? 'Admin session could not be started.' : 'Incorrect password.';
                setMsg('loginMsg', '✗ ' + message, false);
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

    /* Admin can replace or remove any card's photo/logo, e.g. if an owner uploads something inappropriate. */
    var IMAGE_KINDS = { photo: { field: 'f_photoUrl', max: 800 }, logo: { field: 'f_companyLogoUrl', max: 600 } };

    async function imageCall(kind, method, body) {
        var id = safeId();
        var headers = body ? { 'Content-Type': 'image/jpeg' } : {};
        var resp = await fetch('/api/card-image?id=' + encodeURIComponent(id) + '&kind=' + kind, { method: method, headers: headers, body: body });
        var data = await safeJson(resp);
        return { ok: resp.ok && data.success, error: data.error, url: data.url || '' };
    }

    function imageApplied(kind, url) {
        $(IMAGE_KINDS[kind].field).value = url;
        if (kind === 'photo') buildPhotoPreview(url);
        schedulePreview();
    }

    function bindImageTools(kind) {
        var say = function (t) { $('st_' + kind).textContent = t; };
        $('up_' + kind).addEventListener('click', async function () {
            if (!safeId()) { say('Enter a page ID first.'); return; }
            var f = $('file_' + kind).files[0];
            if (!f) { say('Choose an image first.'); return; }
            say('Preparing…');
            try {
                var blob = await window.MyCardImage.shrink(f, IMAGE_KINDS[kind].max);
                if (!blob || blob.size > 250000) { say('Too large. Try a different image.'); return; }
                var r = await imageCall(kind, 'POST', blob);
                if (!r.ok) { say(r.error || 'Upload failed.'); return; }
                imageApplied(kind, r.url);
                $('file_' + kind).value = '';
                say('Saved.');
            } catch (e) { say('Could not read that image.'); }
        });
        $('rm_' + kind).addEventListener('click', async function () {
            if (!safeId()) { say('Enter a page ID first.'); return; }
            var r = await imageCall(kind, 'DELETE');
            if (!r.ok) { say(r.error || 'Could not remove it.'); return; }
            imageApplied(kind, '');
            say('Removed.');
        });
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

    async function ownerAction(action) {
        var id = safeId();
        var out = $('claimCodeOut');
        out.style.display = 'none';
        if (!id && action !== 'create-claim') { setMsg('ownerMsg', 'Please enter a Page ID.', false); return; }
        if (action === 'remove-owner' && !window.confirm('Remove the owner of "' + id + '"? They will lose access and any pending claim code stops working.')) return;
        try {
            var r = await api('/api/card-owner', { action: action, id: id });
            if (!r.ok) { setMsg('ownerMsg', '✗ ' + (r.data.error || 'Failed'), false); return; }
            if (action === 'create-claim') {
                id = r.data.id;
                $('cardId').value = id;
                updateNfcUrl();
                out.value = r.data.code;
                out.style.display = '';
                out.select();
                setMsg('ownerMsg', '✓ Claim code for "' + id + '" (shown once, copy it now):', true);
            } else if (action === 'owner-status') {
                setMsg('ownerMsg', r.data.claimed ? 'Claimed by ' + r.data.email : (r.data.claimPending ? 'Not claimed yet — a claim code is waiting.' : 'No owner and no claim code.'), true);
            } else {
                setMsg('ownerMsg', '✓ Owner removed for "' + id + '".', true);
            }
        } catch (e) { setMsg('ownerMsg', '✗ Error: ' + e.message, false); }
    }

    var lastBatchCsv = '';

    async function generateBatch() {
        var count = Number($('batchCount').value);
        $('batchDownloadBtn').style.display = 'none';
        if (!Number.isInteger(count) || count < 1 || count > 100) { setMsg('batchMsg', 'Enter a whole number from 1 to 100.', false); return; }
        $('batchBtn').disabled = true;
        setMsg('batchMsg', 'Generating…', true);
        try {
            var r = await api('/api/card-owner', { action: 'create-batch', count: count });
            if (!r.ok) { setMsg('batchMsg', '✗ ' + (r.data.error || 'Failed'), false); return; }
            lastBatchCsv = 'Card ID,URL,Claim code\n' + r.data.cards.map(function (c) { return [c.id, c.url, c.code].join(','); }).join('\n') + '\n';
            $('batchDownloadBtn').style.display = '';
            setMsg('batchMsg', '✓ ' + r.data.cards.length + ' cards created. ' +
                (r.data.emailed ? 'List emailed to ' + r.data.emailedTo + '.' : 'The email could not be sent — download the CSV now, the codes cannot be shown again.'), !!r.data.emailed);
            listOwners();
        } catch (e) { setMsg('batchMsg', '✗ Error: ' + e.message, false); }
        finally { $('batchBtn').disabled = false; }
    }

    function downloadBatch() {
        var url = URL.createObjectURL(new Blob([lastBatchCsv], { type: 'text/csv' }));
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mycard-batch-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    async function listOwners() {
        var host = $('ownersList');
        try {
            var r = await api('/api/card-owner', { action: 'list-owners' });
            if (!r.ok) { setMsg('ownersListMsg', '✗ ' + (r.data.error || 'Failed'), false); return; }
            $('ownersListMsg').textContent = '';
            function group(title, rows, detail) {
                var wrap = document.createElement('div');
                var h = document.createElement('h3');
                h.style.cssText = 'margin:16px 0 8px;font-size:1rem;';
                h.textContent = title + ' (' + rows.length + ')';
                wrap.appendChild(h);
                if (!rows.length) {
                    var none = document.createElement('div');
                    none.style.color = 'var(--text-muted)';
                    none.textContent = 'None';
                    wrap.appendChild(none);
                }
                rows.forEach(function (row) {
                    var item = document.createElement('div');
                    item.className = 'page-list-item';
                    var idEl = document.createElement('span');
                    idEl.className = 'id';
                    idEl.textContent = row.id;
                    var info = document.createElement('span');
                    info.className = 'dob';
                    info.textContent = detail(row);
                    var open = document.createElement('button');
                    open.type = 'button';
                    open.className = 'secondary';
                    open.textContent = 'Select';
                    open.addEventListener('click', function () { $('cardId').value = row.id; updateNfcUrl(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                    item.appendChild(idEl);
                    item.appendChild(info);
                    item.appendChild(open);
                    wrap.appendChild(item);
                });
                return wrap;
            }
            var day = function (iso) { return iso ? iso.slice(0, 10) : 'unknown date'; };
            host.replaceChildren(
                group('Claimed', r.data.claimed, function (row) { return row.email + ' · claimed ' + day(row.created) + (row.sub ? ' · via ' + row.sub : ''); }),
                group('Unclaimed', r.data.unclaimed, function (row) { return 'code issued ' + day(row.created) + (row.sub ? ' · via ' + row.sub : ''); })
            );
        } catch (e) { setMsg('ownersListMsg', '✗ Error: ' + e.message, false); }
    }

    /* ===== Subcontractors ===== */
    function subApi(payload) { return api('/api/card-sub', payload); }

    function pickSubLogo(sub) {
        var input = $('subLogoFile');
        input.value = '';
        input.onchange = async function () {
            var f = input.files[0];
            if (!f) return;
            try {
                var blob = await window.MyCardImage.shrink(f, 600);
                if (!blob || blob.size > 250000) { setMsg('subMsg', '✗ That image is too large. Try a different one.', false); return; }
                var resp = await fetch('/api/card-image?sub=' + encodeURIComponent(sub.id) + '&kind=logo', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
                var d = await safeJson(resp);
                setMsg('subMsg', resp.ok && d.success ? '✓ Logo saved for ' + sub.name + '.' : '✗ ' + (d.error || 'Failed'), resp.ok && d.success);
            } catch (e) { setMsg('subMsg', '✗ Could not read that image.', false); }
            listSubs();
        };
        input.click();
    }

    async function listSubs() {
        var r = await subApi({ action: 'list' });
        var host = $('subList');
        host.replaceChildren();
        if (!r.ok) { setMsg('subMsg', '✗ ' + (r.data.error || 'Failed'), false); return; }
        if (!r.data.subs.length) setMsg('subMsg', 'No subcontractors yet.', true);
        var sel = $('moveTo');
        while (sel.options.length > 1) sel.remove(1);
        r.data.subs.forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
        r.data.subs.forEach(function (s) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,0.12);';
            if (s.hasLogo) {
                var img = document.createElement('img');
                img.src = '/api/card-image?sub=' + encodeURIComponent(s.id) + '&kind=logo&v=' + encodeURIComponent(s.logoV || '');
                img.alt = 'Logo';
                img.style.cssText = 'height:36px;max-width:90px;background:#fff;border-radius:4px;';
                row.appendChild(img);
            }
            var info = document.createElement('span');
            info.style.flex = '1 1 220px';
            info.textContent = s.name + ' · ' + s.email + ' · ' + s.used + '/' + s.allowance + ' cards · ' +
                (s.enabled ? 'ON' : 'OFF') + (s.passwordSet ? '' : ' · waiting for password');
            row.appendChild(info);
            function btn(label, fn) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'secondary';
                b.textContent = label;
                b.addEventListener('click', fn);
                row.appendChild(b);
            }
            btn(s.enabled ? 'Turn off' : 'Turn on', async function () {
                var u = await subApi({ action: 'update', id: s.id, enabled: !s.enabled });
                setMsg('subMsg', u.ok ? '✓ Updated.' : '✗ ' + (u.data.error || 'Failed'), u.ok);
                listSubs();
            });
            btn('Change allowance', async function () {
                var v = window.prompt('New card allowance for ' + s.name + ' (1–10000):', String(s.allowance));
                if (v === null) return;
                var u = await subApi({ action: 'update', id: s.id, allowance: Number(v) });
                setMsg('subMsg', u.ok ? '✓ Updated.' : '✗ ' + (u.data.error || 'Failed'), u.ok);
                listSubs();
            });
            btn('Allocate cards', async function () {
                var left = Math.max(0, s.allowance - s.used);
                var v = window.prompt('How many cards to allocate to ' + s.name + '? (' + left + ' left in their allowance)', String(Math.min(left, 10) || 1));
                if (v === null) return;
                var u = await subApi({ action: 'allocate', id: s.id, count: Number(v) });
                setMsg('subMsg', u.ok ? '✓ ' + u.data.cards.length + ' cards allocated. ' + (u.data.emailed ? 'URLs and codes emailed to ' + u.data.emailedTo + '.' : 'The email could not be sent, so the codes were NOT delivered; check Resend.') : '✗ ' + (u.data.error || 'Failed'), u.ok && u.data.emailed);
                listSubs();
            });
            btn(s.hasLogo ? 'Replace logo' : 'Set logo', function () { pickSubLogo(s); });
            if (s.hasLogo) btn('Remove logo', async function () {
                var resp = await fetch('/api/card-image?sub=' + encodeURIComponent(s.id) + '&kind=logo', { method: 'DELETE' });
                setMsg('subMsg', resp.ok ? '✓ Logo removed.' : '✗ Could not remove it.', resp.ok);
                listSubs();
            });
            btn('Delete', async function () {
                if (!window.confirm('Delete ' + s.name + '? Their ' + s.used + ' cards stay live and become your own cards (the issuer logo is removed). This cannot be undone.')) return;
                var u = await subApi({ action: 'delete', id: s.id });
                setMsg('subMsg', u.ok ? '✓ Deleted.' : '✗ ' + (u.data.error || 'Failed'), u.ok);
                listSubs();
            });
            if (!s.passwordSet) btn('Resend invite', async function () {
                var u = await subApi({ action: 'resend-invite', id: s.id });
                setMsg('subMsg', u.ok && u.data.emailed ? '✓ Invite sent.' : '✗ Could not send the invite.', u.ok && u.data.emailed);
            });
            host.appendChild(row);
        });
    }

    async function moveCard() {
        var r = await subApi({ action: 'move', cardId: $('moveCardId').value.trim(), to: $('moveTo').value });
        setMsg('subMsg', r.ok ? '✓ Card moved.' : '✗ ' + (r.data.error || 'Failed'), r.ok);
        if (r.ok) { $('moveCardId').value = ''; listSubs(); }
    }

    async function createSub() {
        var r = await subApi({ action: 'create', name: $('subName').value, email: $('subEmail').value, allowance: Number($('subAllowance').value) });
        if (!r.ok) { setMsg('subMsg', '✗ ' + (r.data.error || 'Failed'), false); return; }
        setMsg('subMsg', r.data.emailed ? '✓ Added. An email was sent so they can choose a password.' : '✓ Added, but the invite email could not be sent. Use Resend invite.', true);
        $('subName').value = '';
        $('subEmail').value = '';
        listSubs();
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
            if (!Array.isArray(r.data.pages)) {
                status('');
                setMsg('listMsg', '✗ Invalid card list response.', false);
                return;
            }
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
    bindImageTools('photo');
    bindImageTools('logo');
    $('saveBtn').addEventListener('click', saveCard);
    $('loadBtn').addEventListener('click', function () { loadCard(); });
    $('newBtn').addEventListener('click', clearForm);
    $('deleteBtn').addEventListener('click', deleteCard);
    $('setPassBtn').addEventListener('click', setPassword);
    $('delPassBtn').addEventListener('click', deletePassword);
    $('listBtn').addEventListener('click', listCards);
    $('batchBtn').addEventListener('click', generateBatch);
    $('batchDownloadBtn').addEventListener('click', downloadBatch);
    $('ownersListBtn').addEventListener('click', listOwners);
    $('subCreateBtn').addEventListener('click', createSub);
    $('subListBtn').addEventListener('click', listSubs);
    $('moveBtn').addEventListener('click', moveCard);
    $('claimCodeBtn').addEventListener('click', function () { ownerAction('create-claim'); });
    $('ownerStatusBtn').addEventListener('click', function () { ownerAction('owner-status'); });
    $('removeOwnerBtn').addEventListener('click', function () { ownerAction('remove-owner'); });
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
