// functions/api/pet-password.js
// API for managing pet memorial page passwords with hashing and rate limiting.
// Actions: set, delete, verify

import { generateSessionToken, hashPassword, verifyPassword, createSession, validateSession, checkRateLimit, recordFailedAttempt } from '../lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  
  // Enforce HTTPS
  if (request.url.startsWith('http://')) {
    return Response.json({ success: false, error: 'HTTPS required' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, id, password } = body;

  // Get client IP for rate limiting
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  // 'verify' is public (visitors use it to open pages). 'set' and 'delete' need an admin session.
  if (action !== 'verify') {
    const sessionToken = request.headers.get('x-admin-session');
    const session = await validateSession(env, sessionToken);
    if (!session) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

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
      
      // Hash the password before storing
      const hashedPassword = await hashPassword(password.trim());
      await env.PET_PASSWORDS.put(safeId, hashedPassword);
      return Response.json({ success: true, message: `Password set for ${safeId}` });
    }

    case 'delete': {
      await env.PET_PASSWORDS.delete(safeId);
      return Response.json({ success: true, message: `Password removed for ${safeId}` });
    }

    case 'verify': {
      // Rate limiting for admin login
      if (safeId === '__admin__') {
        const limit = await checkRateLimit(env, ip);
        if (!limit.allowed) {
          const retryAfter = Math.ceil((limit.lockedUntil - Date.now()) / 1000);
          return Response.json(
            { success: false, error: 'Too many failed attempts. Try again later.' },
            { status: 429, headers: { 'Retry-After': retryAfter.toString() } }
          );
        }
      }

      const stored = await env.PET_PASSWORDS.get(safeId);
      if (!stored) {
        // No password set for this page (allow viewing)
        return Response.json({ success: true });
      }

      if (!password || typeof password !== 'string') {
        // Record failed attempt for rate limiting
        if (safeId === '__admin__') {
          await recordFailedAttempt(env, ip);
        }
        return Response.json({ success: false, error: 'Password required' }, { status: 401 });
      }

      // Compare plaintext password with stored hash
      const isValid = await verifyPassword(password, stored);
      if (isValid) {
        // Generate session token for admin login
        if (safeId === '__admin__') {
          const token = generateSessionToken();
          const session = await createSession(env, token, '__admin__');
          return Response.json({ success: true, sessionToken: token, expiresAt: session.expiresAt });
        }
        return Response.json({ success: true });
      }

      // Record failed attempt for rate limiting
      if (safeId === '__admin__') {
        const data = await recordFailedAttempt(env, ip);
        if (data.lockedUntil) {
          const retryAfter = Math.ceil((data.lockedUntil - Date.now()) / 1000);
          return Response.json(
            { success: false, error: 'Too many failed attempts. Try again later.' },
            { status: 429, headers: { 'Retry-After': retryAfter.toString() } }
          );
        }
      }

      return Response.json({ success: false, error: 'Incorrect password' }, { status: 401 });
    }

    default:
      return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }
}
