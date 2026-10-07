// functions/api/pet-content.js
// API for managing pet memorial page content in KV.
// Actions: set-content, get-content, delete-content, list-content
// Requires valid session token for modifications.

import { validateSession } from '../lib/auth.js';

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

  const { action, id, dob, name, photoUrl, text, audioUrl, photoPosition } = body;

  // Require session token for modifications (set, delete)
  if (action === 'set-content' || action === 'delete-content') {
    const sessionToken = request.headers.get('x-admin-session');
    const session = await validateSession(env, sessionToken);
    if (!session) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!id && action !== 'list-content') {
    return Response.json({ success: false, error: 'Page ID is required' }, { status: 400 });
  }

  const safeId = id ? id.trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
  if (!safeId && action !== 'list-content') {
    return Response.json({ success: false, error: 'Invalid page ID' }, { status: 400 });
  }

  switch (action) {
    case 'set-content': {
      const posRe = /^(\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%$/;
      const normalisePos = (v) => {
        if (typeof v !== 'string') return null;
        const m = v.trim().match(posRe);
        if (!m) return null;
        const clamp = (n) => Math.min(100, Math.max(0, parseFloat(n)));
        return clamp(m[1]) + '% ' + clamp(m[2]) + '%';
      };
      let finalPosition = normalisePos(photoPosition);
      if (!finalPosition) {
        try {
          const existingRaw = await env.PET_CONTENT.get(safeId);
          if (existingRaw) finalPosition = normalisePos(JSON.parse(existingRaw).photoPosition);
        } catch {}
      }
      const content = {
        dob: (dob || '').trim(),
        name: (name || '').trim(),
        photoUrl: (photoUrl || '').trim(),
        text: (text || '').trim(),
        audioUrl: (audioUrl || '').trim(),
        photoPosition: finalPosition || '50% 50%',
        updated: new Date().toISOString()
      };
      await env.PET_CONTENT.put(safeId, JSON.stringify(content));
      return Response.json({ success: true, message: `Content saved for ${safeId}` });
    }

    case 'get-content': {
      const raw = await env.PET_CONTENT.get(safeId);
      if (!raw) return Response.json({ success: true, content: null });
      return Response.json({ success: true, content: JSON.parse(raw) });
    }

    case 'delete-content': {
      await env.PET_CONTENT.delete(safeId);
      return Response.json({ success: true, message: `Content removed for ${safeId}` });
    }

    case 'list-content': {
      const list = await env.PET_CONTENT.list();
      const items = [];
      for (const key of list.keys) {
        const raw = await env.PET_CONTENT.get(key.name);
        if (raw) {
          const content = JSON.parse(raw);
          items.push({
            id: key.name,
            dob: content.dob || '',
            hasName: !!content.name,
            hasPhoto: !!content.photoUrl,
            hasText: !!content.text,
            hasAudio: !!content.audioUrl,
            hasPhotoPosition: !!content.photoPosition,
            photoPosition: content.photoPosition || '50% 50%',
            updated: content.updated
          });
        }
      }
      return Response.json({ success: true, pages: items, count: items.length });
    }

    default:
      return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }
}
