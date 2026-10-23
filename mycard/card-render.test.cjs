const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const context = { window: {}, URL };
runInNewContext(readFileSync(`${__dirname}/card-render.js`, 'utf8'), context);
const { buildVCard } = context.window.MyCard;
const cardUrl = 'https://example.com/mycard/?id=example';

test('exports full WhatsApp URLs without losing paths or query parameters', () => {
    for (const whatsapp of [
        'https://wa.me/201067531455',
        'https://wa.me/447700900123',
        'https://wa.me/qr/EXAMPLE?text=Hello%20there&source=card',
        'https://api.whatsapp.com/send?phone=447700900123&text=Hello%20there',
        'https://wa.me/447700900123?text=Hello,there;friend',
    ]) {
        const vcard = buildVCard({ whatsapp }, cardUrl);
        assert.ok(vcard.includes(`\r\nitem1.URL:${whatsapp}\r\nitem1.X-ABLabel:WhatsApp\r\n`));
    }
});

test('normalizes supported phone formats', () => {
    for (const whatsapp of ['447700900123', '+44 (7700) 900-123', '  +44 7700 900123  ']) {
        assert.ok(buildVCard({ whatsapp }, cardUrl).includes('\r\nitem1.URL:https://wa.me/447700900123\r\n'));
    }
});

test('omits WhatsApp for missing, blank, invalid, and unsafe values', () => {
    const baseline = buildVCard({}, cardUrl);
    for (const whatsapp of [
        undefined, null, '', ' \t ', 447700900123, '1234', 'not a number',
        'http://wa.me/447700900123',
        'javascript:447700900123',
        'data:text/plain,447700900123',
        'ftp://wa.me/447700900123',
        '//wa.me/447700900123',
        'https://example.com/447700900123',
        'https://wa.me.example.com/447700900123',
        'https://wa.me@evil.example/447700900123',
        'https://wa.me:8443/447700900123',
    ]) {
        assert.equal(buildVCard({ whatsapp }, cardUrl), baseline, String(whatsapp));
    }
});

test('preserves existing fields and CRLF serialization with a website or card URL', () => {
    const card = {
        name: 'Alex Example',
        company: 'Example, Ltd',
        title: 'Director',
        phone: '+44 7700 900123',
        email: 'alex@example.com',
        bio: 'Hello;\nWelcome',
        photoUrl: 'https://example.com/photo.jpg',
    };
    for (const website of [undefined, 'https://example.com/website']) {
        const original = buildVCard({ ...card, website }, cardUrl);
        const vcard = buildVCard({ ...card, website, whatsapp: '+44 7700 900123' }, cardUrl);
        assert.equal(vcard.replace('item1.URL:https://wa.me/447700900123\r\nitem1.X-ABLabel:WhatsApp\r\n', ''), original);
        for (const line of [
            'BEGIN:VCARD', 'VERSION:3.0', 'FN:Alex Example', 'N:Example;Alex;;;',
            'ORG:Example\\, Ltd', 'TITLE:Director', 'TEL;TYPE=CELL:+447700900123',
            'EMAIL;TYPE=INTERNET:alex@example.com', `URL:${website || cardUrl}`,
            'NOTE:Hello\\;\\nWelcome', 'PHOTO;VALUE=uri:https://example.com/photo.jpg',
        ]) {
            assert.ok(vcard.split('\r\n').includes(line), line);
        }
        assert.ok(vcard.endsWith('\r\nEND:VCARD\r\n'));
        assert.equal(vcard.match(/END:VCARD/g).length, 1);
        assert.doesNotMatch(vcard.replace(/\r\n/g, ''), /[\r\n]/);
    }
});

test('WhatsApp URL content cannot inject vCard properties', () => {
    const vcard = buildVCard({
        whatsapp: 'https://wa.me/qr/EXAMPLE?text=Hello%0D%0AEND:VCARD\r\nX-INJECTED:yes',
    }, cardUrl);
    assert.equal(vcard.match(/END:VCARD\r\n/g).length, 1);
    assert.ok(!vcard.split('\r\n').some(line => line.startsWith('X-INJECTED:')));
});
