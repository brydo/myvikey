// functions/xmasletters/api/content.js
// API for managing page content (greeting + text + MP3 URL) in XMAS_CONTENT KV.
// Actions: set-content, get-content, delete-content, list-content

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, id, text, greeting, audioUrl } = body;

  if (!id && action !== 'list-content') {
    return Response.json({ success: false, error: 'Page ID is required' }, { status: 400 });
  }

  const safeId = id ? id.trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
  if (!safeId && action !== 'list-content') {
    return Response.json({ success: false, error: 'Invalid page ID' }, { status: 400 });
  }

  switch (action) {
    case 'set-content': {
      const content = {
        greeting: (greeting || '').trim(),
        text: (text || '').trim(),
        audioUrl: (audioUrl || '').trim(),
        updated: new Date().toISOString()
      };
      await env.XMAS_CONTENT.put(safeId, JSON.stringify(content));
      return Response.json({ success: true, message: `Content saved for ${safeId}` });
    }

    case 'get-content': {
      const raw = await env.XMAS_CONTENT.get(safeId);
      if (!raw) return Response.json({ success: true, content: null });
      return Response.json({ success: true, content: JSON.parse(raw) });
    }

    case 'delete-content': {
      await env.XMAS_CONTENT.delete(safeId);
      return Response.json({ success: true, message: `Content removed for ${safeId}` });
    }

    case 'list-content': {
      const list = await env.XMAS_CONTENT.list();
      const items = [];
      for (const key of list.keys) {
        const raw = await env.XMAS_CONTENT.get(key.name);
        if (raw) {
          const content = JSON.parse(raw);
          items.push({ id: key.name, hasGreeting: !!content.greeting, hasText: !!content.text, hasAudio: !!content.audioUrl, updated: content.updated });
        }
      }
      return Response.json({ success: true, pages: items, count: items.length });
    }

    default:
      return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }
}
