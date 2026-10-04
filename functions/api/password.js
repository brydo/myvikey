// functions/api/password.js
// API for managing memorial page passwords in KV.
// Actions: set, delete, verify

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, id, password } = body;

  if (!id || typeof id !== 'string') {
    return Response.json({ success: false, error: 'Page ID is required' }, { status: 400 });
  }

  const safeId = id.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) {
    return Response.json({ success: false, error: 'Invalid page ID' }, { status: 400 });
  }

  switch (action) {
    case 'set': {
      if (!password || typeof password !== 'string') {
        return Response.json({ success: false, error: 'Password is required' }, { status: 400 });
      }
      await env.MEMORIAL_PASSWORDS.put(safeId, password.trim());
      return Response.json({ success: true, message: `Password set for ${safeId}` });
    }

    case 'delete': {
      await env.MEMORIAL_PASSWORDS.delete(safeId);
      return Response.json({ success: true, message: `Password removed for ${safeId}` });
    }

    case 'verify': {
      const stored = await env.MEMORIAL_PASSWORDS.get(safeId);
      if (!stored) {
        return Response.json({ success: true });
      }
      if (password && password === stored) {
        return Response.json({ success: true });
      }
      return Response.json({ success: false, error: 'Incorrect password' }, { status: 401 });
    }

    default:
      return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }
}
