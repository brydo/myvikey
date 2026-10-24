(function () {
    'use strict';

    function copy(type, key, fallback) {
        return window.RSVPThemes && window.RSVPThemes.copy ? window.RSVPThemes.copy(type, key) : fallback;
    }

    function copyNode(element, type, key, fallback) {
        element.setAttribute('data-copy', key);
        element.textContent = copy(type, key, fallback);
    }

    function render(root, response) {
        var card = document.createElement('article');
        card.className = 'rsvp-card';
        var banner = document.createElement('div');
        banner.className = 'rsvp-banner';
        banner.setAttribute('aria-hidden', 'true');
        card.appendChild(banner);
        var heading = document.createElement('h2');
        heading.className = 'rsvp-head';
        copyNode(heading, response.eventType, 'cardHeading', 'RSVP');
        card.appendChild(heading);
        var details = document.createElement('dl');
        details.className = 'rsvp-section';
        [
            ['Name', response.name, 'nameLabel'],
            ['Event', response.event, 'eventLabel'],
            ['Attending', response.attending === 'yes' ? 'Yes' : 'No', 'attendingLabel'],
            ['Guests', response.guests, 'guestsLabel'],
            ['Notes', response.notes || '—', 'receiptNotesLabel']
        ].forEach(function (field) {
            var label = document.createElement('dt');
            copyNode(label, response.eventType, field[2], field[0]);
            var value = document.createElement('dd');
            value.textContent = String(field[1]);
            if (field[2] === 'attendingLabel') {
                copyNode(value, response.eventType, response.attending === 'yes' ? 'yesLabel' : 'noLabel', field[1]);
            }
            details.appendChild(label);
            details.appendChild(value);
        });
        card.appendChild(details);
        root.appendChild(card);
        if (window.RSVPThemes) window.RSVPThemes.apply(card, response.eventType);
    }

    function channels(response, organiser) {
        organiser = organiser || {};
        var message = 'RSVP\nName: ' + response.name + '\nEvent: ' + response.event +
            '\nAttending: ' + (response.attending === 'yes' ? 'Yes' : 'No') +
            '\nGuests (additional): ' + response.guests + '\nNotes: ' + (response.notes || '—');
        var links = [];
        if (typeof organiser.whatsapp === 'string' && /^\+[1-9]\d{7,14}$/.test(organiser.whatsapp)) {
            links.push({ label: copy(response.eventType, 'whatsappLabel', 'Send via WhatsApp'), copyKey: 'whatsappLabel', href: 'https://wa.me/' +
                organiser.whatsapp.slice(1) + '?text=' + encodeURIComponent(message) });
        }
        if (typeof organiser.sms === 'string' && /^\+[1-9]\d{7,14}$/.test(organiser.sms)) {
            links.push({ label: copy(response.eventType, 'smsLabel', 'Send via text/SMS'), copyKey: 'smsLabel', href: 'sms:' + organiser.sms +
                '?&body=' + encodeURIComponent(message) });
        }
        return links;
    }

    function sendOptions(root, response, organiser) {
        root.replaceChildren();
        root.hidden = false;
        var links = channels(response, organiser);
        var help = document.createElement('p');
        copyNode(help, response.eventType, links.length ? 'sendHelp' : 'noChannelsHelp', links.length ?
            'Your RSVP is saved on this site. Choose an app below, then send the message yourself. Nothing has been sent to your host automatically.' :
            'Your RSVP is saved on this site. Your host has no valid WhatsApp or text/SMS number configured; no external message has been sent.');
        root.appendChild(help);
        if (links.length && !links.some(function (link) { return link.href.indexOf('sms:') === 0; })) {
            var unavailable = document.createElement('p');
            copyNode(unavailable, response.eventType, 'smsUnavailable', 'Text/SMS is unavailable because your host has not configured a valid text/SMS number.');
            root.appendChild(unavailable);
        }
        links.forEach(function (link) {
            var anchor = document.createElement('a');
            anchor.className = 'rsvp-btn';
            anchor.setAttribute('data-copy', link.copyKey);
            anchor.textContent = link.label;
            anchor.href = link.href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            root.appendChild(anchor);
        });
        if (window.RSVPThemes) window.RSVPThemes.apply(root, response.eventType);
    }

    window.RSVP = { render: render, channels: channels, sendOptions: sendOptions };
})();
