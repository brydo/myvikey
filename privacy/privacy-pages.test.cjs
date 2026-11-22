const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

test('personal and administration pages declare noindex/nofollow', () => {
  for (const path of [
    'memorials/view.html',
    'foreverpets/view.html',
    'mycard/view.html',
    'rsvp/view.html',
    'xmasletters/index.html',
    'memorials/admin.html',
    'foreverpets/admin.html',
    'mycard/admin.html',
    'rsvp/admin.html',
    'rsvp/host.html',
    'xmasletters/admin.html',
    'xmas/submissions.html'
  ]) {
    const html = readFileSync(`${__dirname}/../${path}`, 'utf8');
    assert.match(html, /<meta\s+name=["']robots["']\s+content=["']noindex(?:,|\s*)nofollow["']/i, path);
  }
});

test('headers and robots disallow dynamic personal routes', () => {
  const headers = readFileSync(`${__dirname}/../_headers`, 'utf8');
  const robots = readFileSync(`${__dirname}/../robots.txt`, 'utf8');
  for (const route of [
    '/memorials/view', '/foreverpets/view', '/mycard/view',
    '/rsvp/view', '/rsvp/i/*', '/xmasletters/*', '/xmas/submissions.html'
  ]) {
    assert.ok(headers.includes(route), route);
  }
  for (const route of [
    '/memorials/view', '/foreverpets/view', '/mycard/view',
    '/rsvp/view', '/rsvp/i/', '/xmasletters/'
  ]) {
    assert.match(robots, new RegExp(`Disallow: ${route.replace('*', '\\*')}`, 'i'));
  }
});
