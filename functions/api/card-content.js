// functions/api/card-content.js
// API for managing MyCard (digital business card) content in KV.
// Actions: set-content, get-content, delete-content, list-content
// Requires valid session token for modifications and listing.
// get-content of a password-protected card requires its password (or an admin session).

import { validateSession, verifyPassword } from '../lib/auth.js';

const TEXT_FIELDS = { name: 100, title: 100, company: 100, bio: 1000, customLabel: 40 };
const URL_FIELDS = {
  photoUrl: ['http:', 'https:'],
  companyLogoUrl: ['http:', 'https:'],
  companyLogoLinkUrl: ['http:', 'https:'],
  website: ['http:', 'https:'],
  mapUrl: ['http:', 'https:'],
  facebook: ['http:', 'https:'],
  instagram: ['http:', 'https:'],
  tiktok: ['http:', 'https:'],
  linkedin: ['http:', 'https:'],
  twitter: ['http:', 'https:'],
  customUrl: ['http:', 'https:']
};
const MAX_URL = 500;
const posRe = /^(\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%$/;
const hexRe = /^#[0-9a-fA-F]{6}$/;

function normalisePos(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(posRe);
  if (!m) return null;
  const clamp = (n) => Math.min(100, Math.max(0, parseFloat(n)));
  return clamp(m[1]) + '% ' + clamp(m[2]) + '%';
}

function cleanText(v, max, label) {
  if (v === undefined || v === null || v === '') return { value: '' };
  if (typeof v !== 'string') return { error: `${label} must be text` };
  const t = v.trim();
  if (t.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { value: t };
}

function cleanUrl(v, protocols, label) {
  if (v === undefined || v === null || v === '') return { value: '' };
  if (typeof v !== 'string') return { error: `${label} must be a URL` };
  const t = v.trim();
  if (!t) return { value: '' };
  if (t.length > MAX_URL) return { error: `${label} must be ${MAX_URL} characters or fewer` };
  let u;
  try { u = new URL(t); } catch { return { error: `${label} is not a valid URL` }; }
  if (!protocols.includes(u.protocol)) return { error: `${label} must start with http:// or https://` };
  return { value: t };
}

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
  if (!body || typeof body !== 'object') {
    return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, id } = body;

  // Require session token for modifications (set, delete)
  if (action === 'set-content' || action === 'delete-content' || action === 'list-content') {
    const sessionToken = request.headers.get('x-admin-session');
    const session = await validateSession(env, sessionToken);
    if (!session) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (action !== 'list-content' && (!id || typeof id !== 'string')) {
    return Response.json({ success: false, error: 'Page ID is required' }, { status: 400 });
  }

  const safeId = typeof id === 'string' ? id.trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
  if (!safeId && action !== 'list-content') {
    return Response.json({ success: false, error: 'Invalid page ID' }, { status: 400 });
  }
  if (safeId === '__admin__') {
    return Response.json({ success: false, error: 'Invalid page ID' }, { status: 400 });
  }

  switch (action) {
    case 'set-content': {
      const content = {};
      for (const [field, max] of Object.entries(TEXT_FIELDS)) {
        const r = cleanText(body[field], max, field);
        if (r.error) return Response.json({ success: false, error: r.error }, { status: 400 });
        content[field] = r.value;
      }
      for (const [field, protocols] of Object.entries(URL_FIELDS)) {
        const r = cleanUrl(body[field], protocols, field);
        if (r.error) return Response.json({ success: false, error: r.error }, { status: 400 });
        content[field] = r.value;
      }
      if (!content.name) {
        return Response.json({ success: false, error: 'Name is required' }, { status: 400 });
      }
      if (content.customUrl && !content.customLabel) content.customLabel = 'Link';

      // Phone: digits, spaces, + ( ) - only
      let phone = body.phone;
      if (phone === undefined || phone === null) phone = '';
      if (typeof phone !== 'string') {
        return Response.json({ success: false, error: 'phone must be text' }, { status: 400 });
      }
      phone = phone.trim();
      if (phone && (phone.length > 30 || !/^[0-9+()\-\s]+$/.test(phone) || phone.replace(/\D/g, '').length < 5)) {
        return Response.json({ success: false, error: 'phone is not a valid phone number' }, { status: 400 });
      }
      content.phone = phone;

      // WhatsApp: a phone number or a https://wa.me/... link
      let whatsapp = body.whatsapp;
      if (whatsapp === undefined || whatsapp === null) whatsapp = '';
      if (typeof whatsapp !== 'string') {
        return Response.json({ success: false, error: 'whatsapp must be text' }, { status: 400 });
      }
      whatsapp = whatsapp.trim();
      if (whatsapp) {
        const isNumber = whatsapp.length <= 30 && /^[0-9+()\-\s]+$/.test(whatsapp) && whatsapp.replace(/\D/g, '').length >= 5;
        const isLink = whatsapp.length <= MAX_URL && /^https:\/\/(wa\.me|api\.whatsapp\.com)\/[^\s]*$/i.test(whatsapp);
        if (!isNumber && !isLink) {
          return Response.json({ success: false, error: 'whatsapp must be a phone number or a https://wa.me/ link' }, { status: 400 });
        }
      }
      content.whatsapp = whatsapp;

      let email = body.email;
      if (email === undefined || email === null) email = '';
      if (typeof email !== 'string') {
        return Response.json({ success: false, error: 'email must be text' }, { status: 400 });
      }
      email = email.trim();
      if (email && (email.length > 254 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email))) {
        return Response.json({ success: false, error: 'email is not valid' }, { status: 400 });
      }
      content.email = email;

      let accent = body.accentColor;
      if (accent === undefined || accent === null) accent = '';
      if (typeof accent !== 'string' || (accent.trim() && !hexRe.test(accent.trim()))) {
        return Response.json({ success: false, error: 'accentColor must be a hex colour like #c9a96e' }, { status: 400 });
      }
      content.accentColor = accent.trim().toLowerCase();

      let finalPosition = normalisePos(body.photoPosition);
      if (!finalPosition) {
        try {
          const existingRaw = await env.CARD_CONTENT.get(safeId);
          if (existingRaw) finalPosition = normalisePos(JSON.parse(existingRaw).photoPosition);
        } catch {}
      }
      content.photoPosition = finalPosition || '50% 50%';
      content.updated = new Date().toISOString();

      await env.CARD_CONTENT.put(safeId, JSON.stringify(content));
      return Response.json({ success: true, message: `Content saved for ${safeId}` });
    }

    case 'get-content': {
      const stored = await env.CARD_PASSWORDS.get(safeId);
      if (stored) {
        const session = await validateSession(env, request.headers.get('x-admin-session'));
        const supplied = typeof body.password === 'string' ? body.password : '';
        if (!session && !(supplied && await verifyPassword(supplied, stored))) {
          return Response.json({ success: false, error: 'Password required' }, { status: 401 });
        }
      }
      const raw = await env.CARD_CONTENT.get(safeId);
      if (!raw) return Response.json({ success: true, content: null });
      return Response.json({ success: true, content: JSON.parse(raw) });
    }

    case 'delete-content': {
      await env.CARD_CONTENT.delete(safeId);
      return Response.json({ success: true, message: `Content removed for ${safeId}` });
    }

    case 'list-content': {
      const keys = [];
      let cursor;
      do {
        const list = await env.CARD_CONTENT.list(cursor ? { cursor } : undefined);
        keys.push(...list.keys);
        cursor = list.list_complete === false ? list.cursor : undefined;
      } while (cursor);
      const raws = await Promise.all(keys.map((k) => env.CARD_CONTENT.get(k.name)));
      const items = [];
      keys.forEach((key, i) => {
        if (!raws[i]) return;
        let content;
        try { content = JSON.parse(raws[i]); } catch { return; }
        items.push({
          id: key.name,
          name: content.name || '',
          title: content.title || '',
          hasPhoto: !!content.photoUrl,
          photoPosition: content.photoPosition || '50% 50%',
          updated: content.updated
        });
      });
      return Response.json({ success: true, pages: items, count: items.length });
    }

    default:
      return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }
}
