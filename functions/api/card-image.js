// functions/api/card-image.js
// Owner-uploaded MyCard photo and company logo.
// GET    ?id=&kind=photo|logo   public image (JPEG)
// POST   ?id=&kind=...          owner uploads a JPEG (X-Owner-Session); the browser has already shrunk it
// DELETE ?id=&kind=...          owner removes the image
// The admin (X-Admin-Session) may also upload or remove any card's image.
// Images are re-checked here: JPEG only, size and pixel limits, and EXIF/GPS/comment metadata is stripped.

import { validateSession } from '../lib/auth.js';
import { cleanCardId, validateOwnerSession, isLimited, bump, imageKey } from '../lib/card-owner.js';

const MAX_IMAGE_BYTES = 250000;
const MAX_PIXELS = 1600;
const UPLOADS_PER_HOUR = 30;
const FIELD = { photo: 'photoUrl', logo: 'companyLogoUrl' };

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400) => json({ success: false, error }, status);

const toBase64 = (b) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

// Returns a copy of the JPEG without metadata segments, or null if it is not a sane JPEG.
export function cleanJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  const out = [bytes.subarray(0, 2)];
  let i = 2;
  let sized = false;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    if (marker === 0xda) {
      if (!sized) return null;
      out.push(bytes.subarray(i));
      const total = out.reduce((n, p) => n + p.length, 0);
      const res = new Uint8Array(total);
      let o = 0;
      for (const p of out) { res.set(p, o); o += p.length; }
      return res;
    }
    if (marker >= 0xc0 && marker <= 0xc2) {
      const h = (bytes[i + 5] << 8) | bytes[i + 6];
      const w = (bytes[i + 7] << 8) | bytes[i + 8];
      if (!h || !w || h > MAX_PIXELS || w > MAX_PIXELS) return null;
      sized = true;
    }
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) out.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

function parse(request, env) {
  const url = new URL(request.url);
  const id = cleanCardId(url.searchParams.get('id'));
  const kind = url.searchParams.get('kind');
  if (!id || !FIELD[kind]) return null;
  return { id, kind, origin: url.origin };
}

// Keeps the saved card pointing at the current image (if the card already has details saved). Returns the new address.
async function linkToCard(env, id, kind, origin, present) {
  const url = present ? `${origin}/api/card-image?id=${encodeURIComponent(id)}&kind=${kind}&v=${Date.now()}` : '';
  const raw = await env.CARD_CONTENT.get(id);
  if (!raw) return url;
  let content;
  try { content = JSON.parse(raw); } catch { return url; }
  content[FIELD[kind]] = url;
  await env.CARD_CONTENT.put(id, JSON.stringify(content));
  return url;
}

export async function onRequestGet({ request, env }) {
  const p = parse(request, env);
  if (!p) return new Response('Not found', { status: 404 });
  const data = await env.CARD_PASSWORDS.get(imageKey(p.kind, p.id));
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'"
    }
  });
}

async function owned(request, env, p) {
  const origin = request.headers.get('origin');
  if (origin && origin !== p.origin) return fail('Cross-origin request rejected', 403);
  // The admin can also replace or remove any card's image (e.g. anything inappropriate).
  const admin = await validateSession(env, request.headers.get('x-admin-session'));
  if (admin) return null;
  const session = await validateOwnerSession(env, request.headers.get('x-owner-session'), p.id);
  return session ? null : fail('Please sign in again.', 401);
}

export async function onRequestPost({ request, env }) {
  const p = parse(request, env);
  if (!p) return fail('Invalid image request');
  const denied = await owned(request, env, p);
  if (denied) return denied;

  const limitKey = 'img:' + p.id;
  if (await isLimited(env, limitKey, UPLOADS_PER_HOUR)) return fail('Too many uploads. Please try again later.', 429);
  if (Number(request.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) return fail('Image is too large.', 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) return fail('Image is too large.', 413);
  await bump(env, limitKey, 3600);

  const clean = cleanJpeg(bytes);
  if (!clean) return fail('Image must be a JPEG no larger than ' + MAX_PIXELS + 'px.');
  await env.CARD_PASSWORDS.put(imageKey(p.kind, p.id), toBase64(clean));
  const url = await linkToCard(env, p.id, p.kind, p.origin, true);
  return json({ success: true, url });
}

export async function onRequestDelete({ request, env }) {
  const p = parse(request, env);
  if (!p) return fail('Invalid image request');
  const denied = await owned(request, env, p);
  if (denied) return denied;
  await env.CARD_PASSWORDS.delete(imageKey(p.kind, p.id));
  await linkToCard(env, p.id, p.kind, p.origin, false);
  return json({ success: true, url: '' });
}
