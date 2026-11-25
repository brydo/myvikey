// functions/lib/card-owner.js
// Helpers for MyCard owner accounts. Owner data lives in CARD_PASSWORDS under prefixed keys
// ("owner:", "claim:", "verify:", "reset:", "session:"). Card IDs cannot contain ":" so these
// never collide with card passwords. Owner sessions are deliberately NOT stored in
// ADMIN_SESSIONS, because admin endpoints accept any session found there.

export const OWNER_SESSION_TTL_SEC = 30 * 60;
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function cleanCardId(id) {
  return typeof id === 'string' ? id.trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 16 characters (~80 bits), shown as XXXX-XXXX-XXXX-XXXX
export function generateClaimCode() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const chars = [...arr].map((b) => CLAIM_ALPHABET[b % CLAIM_ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

export function normaliseClaimCode(code) {
  return typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

export function claimHash(id, code) {
  return sha256Hex('claim:' + id + ':' + normaliseClaimCode(code));
}

export function cleanEmail(email) {
  if (typeof email !== 'string') return '';
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) ? e : '';
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || !password.trim()) return 'Password is required';
  const p = password.trim();
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (new TextEncoder().encode(p).length > 72) return 'Password is too long (72 bytes maximum)';
  return '';
}

// Owner-uploaded images live in CARD_PASSWORDS as base64 JPEG text.
export function imageKey(kind, id) { return 'image:' + kind + ':' + id; }

export async function readJson(store, key) {
  const raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function createOwnerSession(env, id, version) {
  const token = randomToken();
  const expiresAt = Date.now() + OWNER_SESSION_TTL_SEC * 1000;
  await env.CARD_PASSWORDS.put(
    'session:' + await sha256Hex(token),
    JSON.stringify({ id, v: version, expiresAt }),
    { expirationTtl: OWNER_SESSION_TTL_SEC }
  );
  return { token, expiresAt };
}

// Returns the session only if it belongs to this card and the password has not been reset since.
export async function validateOwnerSession(env, token, id) {
  if (!token || typeof token !== 'string' || !id) return null;
  const session = await readJson(env.CARD_PASSWORDS, 'session:' + await sha256Hex(token));
  if (!session || session.id !== id || Date.now() > session.expiresAt) return null;
  const owner = await readJson(env.CARD_PASSWORDS, 'owner:' + id);
  if (!owner || (owner.version || 0) !== session.v) return null;
  return session;
}

// Fixed-window counters in RATE_LIMIT.
export async function isLimited(env, key, limit) {
  const data = await readJson(env.RATE_LIMIT, key);
  return !!data && Date.now() < data.resetAt && data.count >= limit;
}

export async function bump(env, key, windowSec) {
  const now = Date.now();
  const data = await readJson(env.RATE_LIMIT, key);
  const live = data && now < data.resetAt;
  const next = { count: live ? data.count + 1 : 1, resetAt: live ? data.resetAt : now + windowSec * 1000 };
  const ttl = Math.max(60, Math.ceil((next.resetAt - now) / 1000));
  await env.RATE_LIMIT.put(key, JSON.stringify(next), { expirationTtl: ttl });
}

export async function sendEmail(env, to, subject, html, attachments) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const payload = { from: 'noreply@vi-key.uk', to, subject, html };
    if (attachments) payload.attachments = attachments;
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Claim records hold only a hash of the code. Older records were a bare hash string.
export function parseClaim(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data.h === 'string') return data;
  } catch { /* legacy bare hash */ }
  return { h: raw, created: '' };
}

export async function listKeys(store, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) });
    keys.push(...page.keys.map((k) => k.name.slice(prefix.length)));
    cursor = page.list_complete === false ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

export function newCardId() {
  return 'card-' + randomToken().slice(0, 8);
}

export function baseUrl(env) {
  return (env.PUBLIC_BASE_URL || 'https://vi-key.uk').replace(/\/$/, '');
}

// Creates blank cards, each with its own claim code. With a subcontractor id, the cards are recorded as theirs.
export async function createCards(env, count, subId) {
  const store = env.CARD_PASSWORDS;
  const created = new Date().toISOString();
  const origin = baseUrl(env);
  const cards = [];
  while (cards.length < count) {
    const id = newCardId();
    if (await store.get('claim:' + id) || await store.get('owner:' + id) || await env.CARD_CONTENT.get(id)) continue;
    const code = generateClaimCode();
    await store.put('claim:' + id, JSON.stringify({ h: await claimHash(id, code), created }));
    if (subId) {
      await store.put('cardsub:' + id, subId);
      await store.put('subcard:' + subId + ':' + id, created);
    }
    cards.push({ id, url: `${origin}/mycard/?id=${id}`, code });
  }
  return cards;
}
