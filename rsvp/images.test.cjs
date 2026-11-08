const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(`${__dirname}/../functions/api/images.js`, 'utf8')
    .replace(/^import .*$/m, '').replace('export async function', 'async function');
const context = { Response, URL, validateSession: async (env, token) => token === 'good' };
runInNewContext(source, context);

function call(env, token = 'good') {
    return context.onRequestGet({
        request: new Request('https://example.com/api/images', { headers: token ? { 'x-admin-session': token } : {} }),
        env
    });
}

const bucket = {
    async list({ cursor }) {
        return cursor ? { objects: [{ key: "bg/it's (1).PNG" }], truncated: false } :
            { objects: [{ key: 'notes.txt' }, { key: 'b.jpg' }, { key: 'a b.webp' }], truncated: true, cursor: 'next' };
    }
};

test('image list requires an admin session', async () => {
    assert.equal((await call({ IMAGE_FILES: bucket }, '')).status, 401);
    assert.equal((await call({ IMAGE_FILES: bucket }, 'bad')).status, 401);
});

test('image list reports a missing bucket binding', async () => {
    assert.equal((await call({})).status, 503);
});

test('image list pages, filters, encodes and sorts public URLs', async () => {
    const response = await call({ IMAGE_FILES: bucket, IMAGE_PUBLIC_URL: 'https://img.example.com/' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { files } = await response.json();
    assert.deepEqual(files.map(file => file.url), [
        'https://img.example.com/a%20b.webp',
        'https://img.example.com/b.jpg',
        'https://img.example.com/bg/it%27s%20%281%29.PNG'
    ]);
});

test('image list rejects a non-HTTPS public address and listing failures', async () => {
    assert.equal((await call({ IMAGE_FILES: bucket, IMAGE_PUBLIC_URL: 'http://x.example.com' })).status, 503);
    const failing = { async list() { throw Error('boom'); } };
    assert.equal((await call({ IMAGE_FILES: failing })).status, 503);
});
