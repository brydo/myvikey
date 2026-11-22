// Santa order submissions viewer.
const SUBMISSION_ID = /^sub_\d+_[a-z0-9]*$/;

function reply(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function authorized(request, env) {
  const url = new URL(request.url);
  const secret = request.headers.get('x-form-viewer-secret') || url.searchParams.get('secret');
  return !!secret && !!env.FORM_VIEWER_SECRET && secret === env.FORM_VIEWER_SECRET;
}

export async function onRequestGet({ request, env }) {
  if (!authorized(request, env)) return reply({ error: 'Unauthorized' }, 401);
  if (!env.FORM_SUBMISSIONS) return reply({ error: 'Submission storage is unavailable' }, 503);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id !== null && !SUBMISSION_ID.test(id)) return reply({ error: 'Invalid submission id' }, 400);

  try {
    if (id) {
      const submission = await env.FORM_SUBMISSIONS.get(id);
      if (!submission) return reply({ error: 'Not found' }, 404);
      return reply(JSON.parse(submission));
    }

    const cursor = url.searchParams.get('cursor') || undefined;
    const page = await env.FORM_SUBMISSIONS.list({ prefix: 'sub_', limit: 50, cursor });
    const records = await Promise.all(page.keys.map(async (key) => {
      if (!SUBMISSION_ID.test(key.name)) return null;
      const raw = await env.FORM_SUBMISSIONS.get(key.name);
      if (!raw) return null;
      const submission = JSON.parse(raw);
      return {
        id: key.name,
        timestamp: submission._timestamp || submission.timestamp,
        parent_name: submission.parent_name,
        email: submission.email,
        child_name: submission.child_name
      };
    }));
    return reply({
      submissions: records.filter(Boolean),
      cursor: page.list_complete ? null : page.cursor
    });
  } catch (error) {
    console.error('Unable to read Santa submissions:', error);
    return reply({ error: 'Unable to load submissions' }, 503);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!authorized(request, env)) return reply({ error: 'Unauthorized' }, 401);
  if (!env.FORM_SUBMISSIONS) return reply({ error: 'Submission storage is unavailable' }, 503);

  const id = new URL(request.url).searchParams.get('id');
  if (!id || !SUBMISSION_ID.test(id)) return reply({ error: 'Invalid submission id' }, 400);

  try {
    const indexRaw = await env.FORM_SUBMISSIONS.get('index_submissions');
    if (indexRaw) {
      const index = JSON.parse(indexRaw);
      if (!Array.isArray(index)) throw new Error('Invalid legacy submission index');
      const remaining = index.filter(entry => !entry || entry.id !== id);
      if (remaining.length !== index.length) {
        await env.FORM_SUBMISSIONS.put('index_submissions', JSON.stringify(remaining));
      }
    }
    await env.FORM_SUBMISSIONS.delete(id);
    return reply({ success: true });
  } catch (error) {
    console.error('Unable to delete Santa submission:', error);
    return reply({ error: 'Unable to delete submission' }, 503);
  }
}
