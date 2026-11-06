import './theme-client.js';

(function () {
    'use strict';

    var token = '';
    var invitation = null;
    var replies = [];
    var cursor = '';
    var loadVersion = 0;
    var $ = function (id) { return document.getElementById(id); };
    var pathTypes = { wedding: 'weddings', weddings: 'weddings', event: 'events', events: 'events', party: 'parties',
        parties: 'parties', engagement: 'engagements', engagements: 'engagements', celebration: 'celebration', celebrations: 'celebration' };
    var pathType = /^\/rsvp\/([a-z]+)\/hostlogin/.exec(window.location.pathname || '');
    var params = new URLSearchParams(window.location.search);
    function pathTheme() { return (pathType && pathTypes[pathType[1]]) || params.get('type'); }
    function applyTheme(type) {
        window.RSVPThemes.apply(document.body, window.RSVPThemes.theme(type));
    }
    applyTheme(pathTheme());
    var labels = { yes: 'Going', maybe: 'Maybe', no: 'Not going' };

    function status(text, error) {
        $('message').textContent = text;
        $('message').classList.toggle('error', !!error);
    }

    async function post(payload) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-RSVP-Host-Token'] = token;
        var response = await fetch('/api/rsvp', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
        var data = await response.json();
        if (!response.ok || !data.success) {
            var error = new Error(data.error || 'Request failed. Please try again.');
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function logout() {
        token = '';
        invitation = null;
        replies = [];
        cursor = '';
        loadVersion++;
        $('hostRows').replaceChildren();
        $('hostResults').hidden = true;
        $('hostActions').hidden = true;
        $('more').hidden = true;
        $('hostLogin').hidden = false;
        $('hostPassword').value = '';
        applyTheme(pathTheme());
    }

    function render() {
        var count = function (value) { return replies.filter(function (reply) { return reply.attending === value; }).length; };
        $('hostTitle').textContent = invitation.title;
        var sent = invitation.invitesSent || 0;
        $('hostSummary').textContent = (sent ? sent + ' invites sent · ' : '') + replies.length + ' replied · ' +
            count('yes') + ' going · ' + count('maybe') + ' maybe · ' + count('no') + ' not going' +
            (replies.reduce(function (sum, reply) { return sum + (reply.attending === 'no' ? 0 : reply.guests || 0); }, 0) ?
                ' · ' + replies.reduce(function (sum, reply) { return sum + (reply.attending === 'no' ? 0 : reply.guests || 0); }, 0) + ' additional guests' : '');
        $('hostRows').replaceChildren();
        replies.forEach(function (reply) {
            var row = document.createElement('tr');
            [reply.name, labels[reply.attending] || 'Not going', reply.guests || 0, reply.notes || ''].forEach(function (value) {
                var cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            $('hostRows').appendChild(row);
        });
        $('more').hidden = !cursor;
    }

    async function load(append) {
        var session = token;
        var version = ++loadVersion;
        if (!append) { replies = []; cursor = ''; }
        status('Loading replies…');
        try {
            var data;
            var next = cursor;
            do {
                data = await post({ action: 'host-list', cursor: next });
                if (token !== session || version !== loadVersion) return;
                next = data.cursor || '';
                invitation = data.invitation;
                applyTheme(invitation.eventType);
                replies = replies.concat(data.responses);
            } while (next && !data.responses.length);
            cursor = next;
            render();
            status(replies.length ? '' : 'No replies yet.');
        } catch (error) {
            if (token !== session || version !== loadVersion) return;
            if (error.status === 401) logout();
            status(error.message || 'Unable to load replies.', true);
        }
    }

    async function everything() {
        while (cursor) await load(true);
        return replies;
    }

    async function download(kind) {
        var session = token;
        status('Preparing download…');
        try {
            var all = await everything();
            if (token !== session) return;
            var name = 'rsvp-' + invitation.id;
            if (kind === 'csv') {
                window.RSVPExport.download(window.RSVPExport.csv(all), name + '.csv', 'text/csv;charset=utf-8');
            } else {
                window.RSVPExport.download(window.RSVPExport.workbook([invitation], all), name + '.xlsx',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            }
            status('Download ready.');
        } catch (error) {
            status(error.message || 'Unable to download replies.', true);
        }
    }

    $('hostLogin').addEventListener('submit', async function (event) {
        event.preventDefault();
        var button = $('hostLogin').querySelector('button');
        button.disabled = true;
        status('Signing in…');
        try {
            var data = await post({ action: 'host-login', id: $('hostEvent').value.trim(), password: $('hostPassword').value });
            token = data.hostToken;
            $('hostPassword').value = '';
            $('hostLogin').hidden = true;
            $('hostActions').hidden = false;
            $('hostResults').hidden = false;
            await load(false);
        } catch (error) {
            status(error.message || 'Unable to sign in.', true);
        } finally { button.disabled = false; }
    });
    $('hostRefresh').addEventListener('click', function () { load(false); });
    $('more').addEventListener('click', function () { load(true); });
    $('hostPrint').addEventListener('click', async function () {
        try { await everything(); render(); window.print(); } catch (error) { status(error.message || 'Unable to print.', true); }
    });
    $('hostCsv').addEventListener('click', function () { download('csv'); });
    $('hostXlsx').addEventListener('click', function () { download('xlsx'); });
    $('hostLogout').addEventListener('click', function () { logout(); status('Signed out.'); });

    var preset = params.get('id');
    if (preset) $('hostEvent').value = preset;
})();
