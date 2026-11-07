const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(`${__dirname}/../functions/api/audio.js`, 'utf8').replace('export async function', 'async function');
const context = { Response, URL };
runInNewContext(source, context);

function fixture() {
    const data = Buffer.from('0123456789');
    const bucket = {
        async head(key) { return key === 'folder/song.mp3' ? { size: data.length } : null; },
        async get(key, options) {
            if (key !== 'folder/song.mp3') return null;
            const range = options && options.range;
            return { size: data.length, body: range ? data.subarray(range.offset, range.offset + range.length) : data };
        },
        async list({ cursor }) {
            return cursor ? { objects: [{ key: 'folder/song.mp3', size: 10, uploaded: new Date(0) }], truncated: false } :
                { objects: [{ key: 'notes.txt', size: 2, uploaded: new Date(0) },
                    { key: 'Other.WAV', size: 5, uploaded: new Date(0) }], truncated: true, cursor: 'next' };
        }
    };
    return (path, headers = {}) => context.onRequestGet({
        request: new Request('https://example.com/api/audio' + path, { headers }),
        env: { AUDIO_FILES: bucket }
    });
}

test('audio library lists all pages and filters non-audio objects', async () => {
    const response = await fixture()('');
    const result = await response.json();
    assert.deepEqual(result.files.map(file => file.key), ['folder/song.mp3', 'Other.WAV']);
});

test('audio supports full and ranged requests for browser playback and seeking', async () => {
    const get = fixture();
    const path = '?file=' + encodeURIComponent('folder/song.mp3');
    const full = await get(path);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-length'), '10');
    assert.equal(await full.text(), '0123456789');
    for (const [range, contentRange, contents] of [
        ['bytes=0-1', 'bytes 0-1/10', '01'],
        ['bytes=3-', 'bytes 3-9/10', '3456789'],
        ['bytes=-3', 'bytes 7-9/10', '789'],
        ['bytes=7-99', 'bytes 7-9/10', '789'],
        ['bytes=-99', 'bytes 0-9/10', '0123456789']
    ]) {
        const response = await get(path, { Range: range });
        assert.equal(response.status, 206, range);
        assert.equal(response.headers.get('content-range'), contentRange);
        assert.equal(Number(response.headers.get('content-length')), contents.length);
        assert.equal(await response.text(), contents);
    }
    for (const range of ['bytes=10-', 'bytes=5-3', 'bytes=-0']) {
        const response = await get(path, { Range: range });
        assert.equal(response.status, 416);
        assert.equal(response.headers.get('content-range'), 'bytes */10');
    }
    const conditional = await get(path, { Range: 'bytes=0-1', 'If-Range': '"old"' });
    assert.equal(conditional.status, 200);
    assert.equal(await conditional.text(), '0123456789');
    assert.equal((await get('?file=missing.mp3', { Range: 'bytes=0-1' })).status, 404);
});
