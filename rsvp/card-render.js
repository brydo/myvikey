(function () {
    'use strict';

    function render(root, response) {
        var card = document.createElement('article');
        card.className = 'rsvp-card';
        var banner = document.createElement('div');
        banner.className = 'rsvp-banner';
        banner.setAttribute('aria-hidden', 'true');
        card.appendChild(banner);
        var heading = document.createElement('h2');
        heading.className = 'rsvp-head';
        heading.textContent = 'RSVP';
        card.appendChild(heading);
        var details = document.createElement('dl');
        details.className = 'rsvp-section';
        [
            ['Name', response.name],
            ['Event', response.event],
            ['Attending', response.attending === 'yes' ? 'Yes' : 'No'],
            ['Guests', response.guests],
            ['Notes', response.notes || '—']
        ].forEach(function (field) {
            var label = document.createElement('dt');
            label.textContent = field[0];
            var value = document.createElement('dd');
            value.textContent = String(field[1]);
            details.appendChild(label);
            details.appendChild(value);
        });
        card.appendChild(details);
        root.appendChild(card);
    }

    function channels(response, organiser) {
        organiser = organiser || {};
        var message = 'RSVP\nName: ' + response.name + '\nEvent: ' + response.event +
            '\nAttending: ' + (response.attending === 'yes' ? 'Yes' : 'No') +
            '\nGuests (additional): ' + response.guests + '\nNotes: ' + (response.notes || '—');
        var links = [];
        if (typeof organiser.whatsapp === 'string' && /^\+[1-9]\d{7,14}$/.test(organiser.whatsapp)) {
            links.push({ label: 'Send via WhatsApp', href: 'https://wa.me/' +
                organiser.whatsapp.slice(1) + '?text=' + encodeURIComponent(message) });
        }
        if (typeof organiser.sms === 'string' && /^\+[1-9]\d{7,14}$/.test(organiser.sms)) {
            links.push({ label: 'Send via text/SMS', href: 'sms:' + organiser.sms +
                '?&body=' + encodeURIComponent(message) });
        }
        return links;
    }

    function sendOptions(root, response, organiser) {
        root.replaceChildren();
        root.hidden = false;
        var links = channels(response, organiser);
        var help = document.createElement('p');
        help.textContent = links.length ?
            'Your RSVP is saved on this site. Choose an app below, then send the message yourself. Nothing has been sent to your host automatically.' :
            'Your RSVP is saved on this site. Your host has no valid WhatsApp or text/SMS number configured; no external message has been sent.';
        if (links.length && !links.some(function (link) { return link.href.indexOf('sms:') === 0; })) {
            help.textContent += ' Text/SMS is unavailable because your host has not configured a valid text/SMS number.';
        }
        root.appendChild(help);
        links.forEach(function (link) {
            var anchor = document.createElement('a');
            anchor.className = 'rsvp-btn';
            anchor.textContent = link.label;
            anchor.href = link.href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            root.appendChild(anchor);
        });
    }

    window.RSVP = { render: render, channels: channels, sendOptions: sendOptions };
})();
