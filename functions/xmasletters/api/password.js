import { hashPassword, verifyPassword } from '../../lib/auth.js';
import { santaExpirationTtl } from '../../lib/retention.js';
import { validateXmasAdminCookie, validateSameOriginMutation } from '../../lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, id, password } = body;
  if (action !== 'check' && action !== 'verify') {
    if (!validateSameOriginMutation(request)) {
      return Response.json({ success: false, error: 'Cross-origin request rejected' }, { status: 403 });
    }
    if (!await validateXmasAdminCookie(env, request)) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  if (!id || typeof id !== 'string') {
    return Response.json({ success: false, error: 'Page ID is required' }, { status: 400 });
  }
  const safeId = id.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return Response.json({ success: false, error: 'Invalid page ID' }, { status: 400 });

  switch (action) {
    case 'set': {
      if (!password || typeof password !== 'string') {
        return Response.json({ success: false, error: 'Password is required' }, { status: 400 });
      }
      const options = safeId === '__admin__' ? undefined : { expirationTtl: santaExpirationTtl() };
      await env.PAGE_PASSWORDS.put(safeId, await hashPassword(password.trim()), options);
      return Response.json({ success: true, message: `Password set for ${safeId}` });
    }
    case 'delete': {
      await env.PAGE_PASSWORDS.delete(safeId);
      return Response.json({ success: true, message: `Password removed for ${safeId}` });
    }
    case 'check': {
      const value = await env.PAGE_PASSWORDS.get(safeId);
      return Response.json({ success: true, hasPassword: !!value });
    }
    default:
      return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }
}
