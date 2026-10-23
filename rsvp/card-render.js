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

    window.RSVP = { render: render };
})();
