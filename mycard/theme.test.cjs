const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

function declarations(file, selector) {
    const source = readFileSync(`${__dirname}/${file}`, 'utf8');
    const block = source.slice(source.indexOf(`${selector} {`)).split('}')[0];
    return Object.fromEntries(block.slice(block.indexOf('{') + 1).split(';')
        .filter(value => value.trim()).map(value => {
            const colon = value.indexOf(':');
            return [value.slice(0, colon).trim(), value.slice(colon + 1).trim().replace(/\s+/g, ' ')];
        }));
}

test('admin uses the charcoal and executive blue palette', () => {
    assert.deepEqual(declarations('admin.html', ':root'), {
        '--bg-color': '#0F1115',
        '--card-bg': '#161A22',
        '--accent': '#4F8CFF',
        '--heading-link': '#4F8CFF',
        '--text-color': '#E6EAF2',
        '--text-muted': '#9AA4B2',
        '--card-border': '#2A3140',
        '--btn-bg': '#1C2230',
        '--danger': '#E35D6A',
        '--success': '#2FBF71',
    });
});

test('public view uses matching page colors', () => {
    assert.deepEqual(declarations('view.html', ':root'), {
        '--bg-base': '#0F1115',
        '--bg-gradient': 'radial-gradient(circle at top, #151A23 0%, #0F1115 72%)',
        '--card-bg': 'rgba(255, 255, 255, 0.04)',
        '--card-border': 'rgba(255, 255, 255, 0.10)',
        '--gold': '#4F8CFF',
        '--text-color': '#E6EAF2',
        '--text-muted': '#9AA4B2',
    });
});

test('shared card uses restrained blue accents and shadows', () => {
    const card = declarations('card.css', '.mc-card');
    assert.equal(card['--mc-accent'], '#4F8CFF');
    assert.equal(card['--mc-accent-text'], '#ffffff');
    assert.equal(card.background, 'rgba(22, 26, 34, 0.88)');
    assert.equal(card.border, '1px solid rgba(255,255,255,0.10)');
    assert.equal(card['box-shadow'], '0 16px 36px rgba(0,0,0,0.38), 0 0 0 1px rgba(79,140,255,0.08)');
    assert.equal(declarations('card.css', '.mc-banner').background,
        'linear-gradient( 135deg, rgba(79,140,255,0.20), rgba(58,111,204,0.16) 55%, rgba(120,146,186,0.14) )');
    assert.equal(declarations('card.css', '.mc-title').color, '#8FB5FF');
    assert.equal(declarations('card.css', '.mc-link-icon').background, '#4F8CFF');
    for (const [selector, color] of [['.mc-btn-primary', '#4F8CFF'], ['.mc-btn-primary:hover', '#3B7BFA']]) {
        const button = declarations('card.css', selector);
        assert.equal(button.background, color);
        assert.equal(button['border-color'], color);
    }
});

test('shared card keyboard focus retains its high-contrast outline', () => {
    const focus = declarations('card.css', '.mc-company-logo-wrap:focus-visible');
    assert.equal(focus.outline, '3px solid #fff');
    assert.equal(focus['outline-offset'], '2px');
    const css = readFileSync(`${__dirname}/card.css`, 'utf8');
    assert.match(css, /\.mc-btn:focus-visible,\s*\.mc-link:focus-visible,\s*\.mc-social-link:focus-visible,\s*\.mc-company-logo-wrap:focus-visible \{/);
});
