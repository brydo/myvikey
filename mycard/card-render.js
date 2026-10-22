/* MyCard renderer - shared by view.html and the admin live preview.
   Builds the card with DOM APIs only (never innerHTML) and validates every URL. */
(function () {
    'use strict';
    var SVG_NS = 'http://www.w3.org/2000/svg';

    var ICONS = {
        phone:    { stroke: true, d: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z'] },
        email:    { stroke: true, d: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 6l-10 7L2 6'] },
        website:  { stroke: true, d: ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'] },
        map:      { stroke: true, d: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'] },
        link:     { stroke: true, d: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'] },
        share:    { stroke: true, d: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'M16 6l-4-4-4 4', 'M12 2v13'] },
        save:     { stroke: true, d: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M19 8v6', 'M22 11h-6'] },
        user:     { stroke: true, d: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z'] },
        whatsapp: { d: ['M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-1.157 4.228 4.305-1.129z'] },
        facebook: { d: ['M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953h-1.529c-1.504 0-1.974.935-1.974 1.893v2.277h3.362l-.537 3.47h-2.825v8.385c5.737-.9 10.125-5.864 10.125-11.854z'] },
        instagram:{ d: ['M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.64.069-4.85.069-3.204 0-3.584-.012-4.849-.069-3.225-.148-4.771-1.664-4.919-4.919-.058-1.265-.07-1.64-.07-4.849 0-3.204.013-3.584.07-4.849.148-3.225 1.664-4.771 4.919-4.919 1.265-.057 1.645-.07 4.849-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.058 1.279-.072 1.687-.072 4.947 0 3.26.014 3.668.072 4.947.2 4.358 2.618 6.78 6.98 6.98 1.279.058 1.687.072 4.947.072 3.26 0 3.668-.014 4.947-.072 4.358-.2 6.78-2.618 6.98-6.98.058-1.279.072-1.687.072-4.947 0-3.26-.014-3.668-.072-4.947-.2-4.358-2.618-6.78-6.98-6.98-1.279-.058-1.687-.072-4.947-.072zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zm0 10.162a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-10.845a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z'] },
        tiktok:   { d: ['M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 7.26-10.28V2.75h3.45c.1 1.02.42 2.01.94 2.88.67 1.12 1.74 1.98 3.1 2.43z'] },
        linkedin: { d: ['M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'] },
        twitter:  { d: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'] },
        youtube:  { d: ['M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z'] },
        telegram: { d: ['M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'] }
    };

    function icon(name) {
        var def = ICONS[name] || ICONS.link;
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('class', 'mc-icon');
        if (def.stroke) {
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
        } else {
            svg.setAttribute('fill', 'currentColor');
        }
        def.d.forEach(function (d) {
            var p = document.createElementNS(SVG_NS, 'path');
            p.setAttribute('d', d);
            svg.appendChild(p);
        });
        return svg;
    }

    function str(v) { return typeof v === 'string' ? v.trim() : ''; }

    /* Only http(s) URLs are ever allowed as external links / images. */
    function safeUrl(v) {
        v = str(v);
        if (!v) return '';
        try {
            var u = new URL(v);
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
        } catch (e) {}
        return '';
    }

    function digits(v) { return str(v).replace(/\D/g, ''); }

    function phoneHref(v) {
        v = str(v);
        var d = v.replace(/[^\d+]/g, '');
        return d.replace(/\D/g, '').length >= 5 ? 'tel:' + d : '';
    }

    function whatsappHref(v) {
        v = str(v);
        if (!v) return '';
        if (/^https?:\/\//i.test(v)) {
            var u = safeUrl(v);
            return u && /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(u) ? u : '';
        }
        var d = digits(v);
        return d.length >= 5 ? 'https://wa.me/' + d : '';
    }

    function emailHref(v) {
        v = str(v);
        return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? 'mailto:' + v : '';
    }

    function validHex(v) { return /^#[0-9a-fA-F]{6}$/.test(str(v)); }

    function readableText(hex) {
        var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#12110F' : '#ffffff';
    }

    function initials(name) {
        var parts = str(name).split(/\s+/).filter(Boolean);
        if (!parts.length) return '';
        var a = Array.from(parts[0])[0] || '';
        var b = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] || '') : '';
        return (a + b).toUpperCase();
    }

    function validPosition(v) {
        return /^\d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/.test(str(v)) ? str(v) : '50% 50%';
    }

    /* Contact rows (large buttons) and social icons, only for fields with a value. */
    function buildLinks(c) {
        var rows = [], social = [], href;
        if ((href = phoneHref(c.phone))) rows.push({ key: 'phone', label: 'Call', sub: str(c.phone), href: href });
        if ((href = whatsappHref(c.whatsapp))) rows.push({ key: 'whatsapp', label: 'WhatsApp', sub: 'Chat on WhatsApp', href: href, external: true });
        if ((href = emailHref(c.email))) rows.push({ key: 'email', label: 'Email', sub: str(c.email), href: href });
        if ((href = safeUrl(c.website))) rows.push({ key: 'website', label: 'Website', sub: href.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: href, external: true });
        if ((href = safeUrl(c.mapUrl))) rows.push({ key: 'map', label: 'Location', sub: 'Open in Maps', href: href, external: true });
        if ((href = safeUrl(c.customUrl))) rows.push({ key: 'link', label: str(c.customLabel) || 'Link', sub: href.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: href, external: true });
        [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['linkedin', 'LinkedIn'],
         ['twitter', 'X (Twitter)'], ['youtube', 'YouTube'], ['telegram', 'Telegram']].forEach(function (s) {
            var h = safeUrl(c[s[0]]);
            if (h) social.push({ key: s[0], label: s[1], href: h, external: true });
        });
        return { rows: rows, social: social };
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }

    function setAnchor(a, item) {
        a.href = item.href;
        if (item.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    }

    /* ---------- vCard ---------- */
    function vEsc(v) {
        return String(v).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
    }

    function buildVCard(c, cardUrl) {
        var name = str(c.name);
        var parts = name.split(/\s+/);
        var last = parts.length > 1 ? parts.pop() : '';
        var first = parts.join(' ');
        var lines = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + vEsc(name), 'N:' + vEsc(last) + ';' + vEsc(first) + ';;;'];
        if (str(c.company)) lines.push('ORG:' + vEsc(str(c.company)));
        if (str(c.title)) lines.push('TITLE:' + vEsc(str(c.title)));
        if (phoneHref(c.phone)) lines.push('TEL;TYPE=CELL:' + vEsc(phoneHref(c.phone).slice(4)));
        if (emailHref(c.email)) lines.push('EMAIL;TYPE=INTERNET:' + vEsc(str(c.email)));
        var site = safeUrl(c.website) || cardUrl;
        if (site) lines.push('URL:' + site);
        if (str(c.bio)) lines.push('NOTE:' + vEsc(str(c.bio)));
        if (safeUrl(c.photoUrl)) lines.push('PHOTO;VALUE=uri:' + safeUrl(c.photoUrl));
        lines.push('END:VCARD');
        return lines.join('\r\n') + '\r\n';
    }

    function downloadVCard(c, cardUrl) {
        var blob = new Blob([buildVCard(c, cardUrl)], { type: 'text/vcard;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (str(c.name).replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'contact') + '.vcf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    /* ---------- QR (uses vendored qrcode.js) ---------- */
    function qrSvg(text) {
        if (typeof window.qrcode !== 'function') return null;
        var qr;
        try { qr = window.qrcode(0, 'M'); qr.addData(text); qr.make(); } catch (e) { return null; }
        var n = qr.getModuleCount(), quiet = 2, size = n + quiet * 2, d = '';
        for (var r = 0; r < n; r++) {
            for (var col = 0; col < n; col++) {
                if (qr.isDark(r, col)) d += 'M' + (col + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
            }
        }
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
        svg.setAttribute('class', 'mc-qr-svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'QR code for this card');
        svg.setAttribute('shape-rendering', 'crispEdges');
        var bg = document.createElementNS(SVG_NS, 'rect');
        bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#ffffff');
        var p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d); p.setAttribute('fill', '#12110F');
        svg.appendChild(bg); svg.appendChild(p);
        return svg;
    }

    /* ---------- Render ---------- */
    function render(root, c, opts) {
        opts = opts || {};
        var cardUrl = opts.url || '';
        var links = buildLinks(c);
        root.replaceChildren();

        var card = el('article', 'mc-card');
        if (validHex(c.accentColor)) {
            var hex = str(c.accentColor);
            card.style.setProperty('--mc-accent', hex);
            card.style.setProperty('--mc-accent-text', readableText(hex));
        }

        card.appendChild(el('div', 'mc-banner'));

        var photo = el('div', 'mc-photo');
        var photoUrl = safeUrl(c.photoUrl);
        var ini = initials(c.name);
        function placeholder() {
            photo.replaceChildren();
            if (ini) photo.appendChild(el('span', 'mc-initials', ini));
            else photo.appendChild(icon('user'));
            photo.setAttribute('role', 'img');
            photo.setAttribute('aria-label', 'Profile photo placeholder');
        }
        if (photoUrl) {
            var img = document.createElement('img');
            img.src = photoUrl;
            img.alt = str(c.name) ? 'Photo of ' + str(c.name) : 'Profile photo';
            img.style.objectPosition = validPosition(c.photoPosition);
            img.addEventListener('error', placeholder);
            photo.appendChild(img);
        } else {
            placeholder();
        }
        card.appendChild(photo);

        var head = el('header', 'mc-head');
        head.appendChild(el('h1', 'mc-name', str(c.name) || 'Your Name'));
        if (str(c.title)) head.appendChild(el('p', 'mc-title', str(c.title)));
        if (str(c.company)) head.appendChild(el('p', 'mc-company', str(c.company)));
        card.appendChild(head);

        var actions = el('div', 'mc-actions');
        var saveBtn = el('button', 'mc-btn mc-btn-primary');
        saveBtn.type = 'button';
        saveBtn.appendChild(icon('save'));
        saveBtn.appendChild(el('span', null, 'Save Contact'));
        saveBtn.setAttribute('aria-label', 'Save contact as vCard');
        saveBtn.addEventListener('click', function () { downloadVCard(c, cardUrl); });
        var shareBtn = el('button', 'mc-btn');
        shareBtn.type = 'button';
        shareBtn.appendChild(icon('share'));
        shareBtn.appendChild(el('span', null, 'Share'));
        shareBtn.setAttribute('aria-label', 'Share this card');
        actions.appendChild(saveBtn);
        actions.appendChild(shareBtn);
        card.appendChild(actions);
        var status = el('p', 'mc-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        card.appendChild(status);
        shareBtn.addEventListener('click', function () {
            var data = { title: str(c.name), text: str(c.name) + (str(c.title) ? ' - ' + str(c.title) : ''), url: cardUrl };
            function copy() {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(cardUrl).then(function () {
                        status.textContent = 'Card link copied to clipboard.';
                    }, function () { status.textContent = 'Copy this link: ' + cardUrl; });
                } else {
                    status.textContent = 'Copy this link: ' + cardUrl;
                }
            }
            if (navigator.share) {
                navigator.share(data).catch(function (e) { if (!e || e.name !== 'AbortError') copy(); });
            } else {
                copy();
            }
        });

        if (str(c.bio)) {
            var about = el('section', 'mc-section');
            about.appendChild(el('h2', 'mc-h2', 'About'));
            about.appendChild(el('p', 'mc-bio', str(c.bio)));
            card.appendChild(about);
        }

        if (links.rows.length) {
            var list = el('ul', 'mc-links');
            links.rows.forEach(function (item) {
                var li = document.createElement('li');
                var a = el('a', 'mc-link mc-link-' + item.key);
                setAnchor(a, item);
                var ic = el('span', 'mc-link-icon');
                ic.appendChild(icon(item.key));
                var txt = el('span', 'mc-link-text');
                txt.appendChild(el('span', 'mc-link-label', item.label));
                if (item.sub) txt.appendChild(el('span', 'mc-link-sub', item.sub));
                a.appendChild(ic);
                a.appendChild(txt);
                li.appendChild(a);
                list.appendChild(li);
            });
            card.appendChild(list);
        }

        if (links.social.length) {
            var soc = el('div', 'mc-social');
            soc.setAttribute('role', 'group');
            soc.setAttribute('aria-label', 'Social links');
            links.social.forEach(function (item) {
                var a = el('a', 'mc-social-link mc-social-' + item.key);
                setAnchor(a, item);
                a.setAttribute('aria-label', item.label);
                a.title = item.label;
                a.appendChild(icon(item.key));
                soc.appendChild(a);
            });
            card.appendChild(soc);
        }

        var qrWrap = el('div', 'mc-qr');
        var svg = cardUrl ? qrSvg(cardUrl) : null;
        if (svg) {
            qrWrap.appendChild(svg);
            qrWrap.appendChild(el('p', 'mc-qr-caption', 'Scan to open this card'));
            card.appendChild(qrWrap);
        }

        root.appendChild(card);
        return card;
    }

    window.MyCard = {
        render: render,
        buildVCard: buildVCard,
        safeUrl: safeUrl,
        validHex: validHex,
        validPosition: validPosition
    };
})();
