const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(`${__dirname}/submit.js`, 'utf8').replace(/^export /gm, '');

function createApp() {
  const submissions = new Map();
  const emailRequests = [];
  const context = {
    Response,
    FormData,
    Date,
    Math,
    console,
    fetch: async (url, options) => {
      emailRequests.push({ url: String(url), options });
      return new Response(JSON.stringify({ id: 'email-id' }), { status: 200 });
    }
  };
  runInNewContext(source, context);

  return {
    submissions,
    emailRequests,
    async post(fields = {}) {
      const body = new FormData();
      body.set('email', 'customer@example.com');
      for (const [key, value] of Object.entries(fields)) body.set(key, value);

      return context.onRequestPost({
        request: new Request('https://vi-key.uk/api/submit', { method: 'POST', body }),
        env: {
          FORM_SUBMISSIONS: {
            async put(key, value) { submissions.set(key, value); }
          }
        }
      });
    }
  };
}

test('rejects a filled honeypot without storing or emailing the submission', async () => {
  const app = createApp();
  const response = await app.post({ _gotcha: 'bot' });

  assert.equal(response.status, 400);
  assert.equal(app.submissions.size, 0);
  assert.equal(app.emailRequests.length, 0);
});

test('accepts a normal submission without storing the honeypot field', async () => {
  const app = createApp();
  const response = await app.post({ _gotcha: '', parent_name: 'Alex' });

  assert.equal(response.status, 200);
  assert.equal(app.submissions.size, 1);
  const storedOrder = JSON.parse([...app.submissions.values()][0]);
  assert.equal(storedOrder.parent_name, 'Alex');
  assert.equal(storedOrder._gotcha, undefined);
  assert.equal(app.emailRequests.length, 2);
});
