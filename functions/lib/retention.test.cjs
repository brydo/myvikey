const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(`${__dirname}/retention.js`, 'utf8').replace(/^export /gm, '');
const context = { Date };
runInNewContext(source, context);

test('Santa deadlines expire at 31 January 23:59:59 UTC', () => {
  assert.equal(context.santaDeletionDeadline(new Date('2026-11-22T21:00:00Z')).toISOString(),
    '2027-01-31T23:59:59.000Z');
  assert.equal(context.santaDeletionDeadline(new Date('2027-02-01T00:00:00Z')).toISOString(),
    '2028-01-31T23:59:59.000Z');
  assert.ok(context.santaExpirationTtl(new Date('2026-11-22T21:00:00Z')) > 60);
});
