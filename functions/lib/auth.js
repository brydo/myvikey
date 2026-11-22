// functions/lib/auth.js
// Authentication and session management utilities

import bcrypt from 'bcryptjs';

// Generate a secure session token
export function generateSessionToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function validateXmasAdminCookie(env, request) {
  if (!env.PAGE_PASSWORDS) return null;
  const adminHash = await env.PAGE_PASSWORDS.get('__admin__');
  if (!adminHash) return null;
  const data = new TextEncoder().encode('__admin__:' + adminHash);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  const cookies = request.headers.get('cookie') || '';
  const cookie = cookies.split(';').map((entry) => entry.trim()).find((entry) =>
    entry.startsWith('auth___admin__='));
  if (!cookie || cookie.slice('auth___admin__='.length) !== expected) return null;
  return { userId: '__admin__' };
}

export function validateSameOriginMutation(request) {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite !== 'same-origin') return false;

  const origin = request.headers.get('origin');
  if (origin) return origin === 'https://vi-key.uk';

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === 'https://vi-key.uk';
    } catch {
      return false;
    }
  }

  const contentType = request.headers.get('content-type') || '';
  return /^application\/json(?:;|$)/i.test(contentType);
}

// Hash a password with bcrypt (salt rounds: 12)
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

// Compare plaintext password with hashed password
export async function verifyPassword(plaintext, hashed) {
  return bcrypt.compare(plaintext, hashed);
}

// Create a session in KV with TTL (30 minutes)
export async function createSession(env, sessionToken, userId) {
  const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
  const sessionData = JSON.stringify({ userId, expiresAt, createdAt: Date.now() });
  await env.ADMIN_SESSIONS.put(sessionToken, sessionData, { expirationTtl: 30 * 60 });
  return { sessionToken, expiresAt };
}

// Validate a session token
export async function validateSession(env, sessionToken) {
  if (!sessionToken || typeof sessionToken !== 'string') {
    return null;
  }
  try {
    const raw = await env.ADMIN_SESSIONS.get(sessionToken);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() > session.expiresAt) {
      await env.ADMIN_SESSIONS.delete(sessionToken);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

// Refresh session expiry
export async function refreshSession(env, sessionToken) {
  const session = await validateSession(env, sessionToken);
  if (!session) return null;
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const updated = { ...session, expiresAt };
  await env.ADMIN_SESSIONS.put(sessionToken, JSON.stringify(updated), { expirationTtl: 30 * 60 });
  return updated;
}

// Rate limiting: check if IP is locked or has exceeded attempt limit
export async function checkRateLimit(env, ip) {
  const key = `rate_limit:${ip}`;
  const raw = await env.RATE_LIMIT.get(key);
  if (!raw) return { allowed: true, attempts: 0, lockedUntil: null };
  
  const data = JSON.parse(raw);
  const now = Date.now();
  
  // Check if still locked
  if (data.lockedUntil && now < data.lockedUntil) {
    return { allowed: false, attempts: data.attempts, lockedUntil: data.lockedUntil };
  }
  
  // Check if within 5-minute window and attempts < 3
  if (data.windowStart && now - data.windowStart < 5 * 60 * 1000) {
    if (data.attempts >= 3) {
      // Lock for 15 minutes
      const locked = { ...data, lockedUntil: now + 15 * 60 * 1000, attempts: data.attempts + 1 };
      await env.RATE_LIMIT.put(key, JSON.stringify(locked), { expirationTtl: 15 * 60 + 5 * 60 });
      return { allowed: false, attempts: locked.attempts, lockedUntil: locked.lockedUntil };
    }
    return { allowed: true, attempts: data.attempts, lockedUntil: null };
  }
  
  // Window expired, reset
  return { allowed: true, attempts: 0, lockedUntil: null };
}

// Record a failed attempt
export async function recordFailedAttempt(env, ip) {
  const key = `rate_limit:${ip}`;
  const raw = await env.RATE_LIMIT.get(key);
  const now = Date.now();
  
  let data;
  if (!raw) {
    data = { attempts: 1, windowStart: now, lockedUntil: null };
  } else {
    data = JSON.parse(raw);
    // Reset window if expired
    if (now - data.windowStart >= 5 * 60 * 1000) {
      data = { attempts: 1, windowStart: now, lockedUntil: null };
    } else {
      data.attempts++;
      // Check if should lock now
      if (data.attempts >= 3) {
        data.lockedUntil = now + 15 * 60 * 1000;
      }
    }
  }
  
  await env.RATE_LIMIT.put(key, JSON.stringify(data), { expirationTtl: 15 * 60 + 5 * 60 });
  return data;
}

export async function verifyPagePassword(env, ip, pageId, password, storedHash) {
  const rateLimitId = `page:${pageId}:${ip}`;
  const limit = await checkRateLimit(env, rateLimitId);
  if (!limit.allowed) return { verified: false, lockedUntil: limit.lockedUntil };
  if (typeof password !== 'string' || !password) return { verified: false };
  if (await verifyPassword(password, storedHash)) return { verified: true };

  const failed = await recordFailedAttempt(env, rateLimitId);
  return { verified: false, lockedUntil: failed.lockedUntil || null };
}
