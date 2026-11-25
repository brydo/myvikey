// Turns an admin session token (from /api/password verify) into the cookie used by
// cookie-protected admin pages such as /xmasletters/admin. Actions: start, end.

import { ADMIN_SESSION_COOKIE, validateSession, validateSameOriginMutation } from '../lib/auth.js';

function cookie(value, maxAge) {
  return `${ADMIN_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!validateSameOriginMutation(request)) {
    return Response.json({ success: false, error: 'Cross-origin request rejected' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.action === 'end') {
    return Response.json({ success: true }, { headers: { 'Set-Cookie': cookie('', 0), 'Cache-Control': 'no-store' } });
  }
  if (body.action !== 'start') {
    return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }

  const session = await validateSession(env, request.headers.get('x-admin-session'));
  if (!session || session.userId !== '__admin__') {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const maxAge = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
  return Response.json({ success: true }, {
    headers: { 'Set-Cookie': cookie(request.headers.get('x-admin-session'), maxAge), 'Cache-Control': 'no-store' }
  });
}
