// Submissions viewer API — password protected
// GET /api/submissions?secret=YOUR_SECRET  → list all submissions
// GET /api/submissions?secret=YOUR_SECRET&id=sub_xxx  → single submission
// DELETE /api/submissions?secret=YOUR_SECRET&id=sub_xxx  → delete submission

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  const id = url.searchParams.get('id');

  if (!secret || secret !== env.FORM_VIEWER_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (id) {
    const submission = await env.FORM_SUBMISSIONS.get(id);
    if (!submission) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(submission, {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const index = await env.FORM_SUBMISSIONS.get('index_submissions');
  return new Response(index || '[]', {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  const id = url.searchParams.get('id');

  if (!secret || secret !== env.FORM_VIEWER_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await env.FORM_SUBMISSIONS.delete(id);

  const indexRaw = await env.FORM_SUBMISSIONS.get('index_submissions');
  let index = indexRaw ? JSON.parse(indexRaw) : [];
  index = index.filter(s => s.id !== id);
  await env.FORM_SUBMISSIONS.put('index_submissions', JSON.stringify(index));

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
