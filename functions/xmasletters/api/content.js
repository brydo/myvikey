export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await request.json();
    const { action, id, text, audioUrl } = body;

    // ── GET CONTENT ──
    if (action === 'get-content') {
      if (!id) return json({ success: false, error: 'Missing id' }, 400);
      const raw = await env.XMAS_CONTENT.get(id);
      if (!raw) return json({ success: true, content: null });
      try {
        const content = JSON.parse(raw);
        return json({ success: true, content });
      } catch {
        // Legacy plain-text value — return as text
        return json({ success: true, content: { text: raw, audioUrl: '' } });
      }
    }

    // ── SET CONTENT ──
    if (action === 'set-content') {
      if (!id) return json({ success: false, error: 'Missing id' }, 400);
      const content = { text: text || '', audioUrl: audioUrl || '' };
      await env.XMAS_CONTENT.put(id, JSON.stringify(content));
      return json({ success: true });
    }

    // ── LIST CONTENT ──
    if (action === 'list-content') {
      const pages = [];
      let cursor;
      do {
        const result = await env.XMAS_CONTENT.list({ cursor });
        for (const key of result.keys) {
          const raw = await env.XMAS_CONTENT.get(key.name);
          let hasText = false;
          let hasAudio = false;
          if (raw) {
            try {
              const c = JSON.parse(raw);
              hasText = !!(c.text && c.text.trim());
              hasAudio = !!(c.audioUrl && c.audioUrl.trim());
            } catch {
              hasText = !!raw.trim();
            }
          }
          // Only include pages that have actual content (text or audio)
          if (hasText || hasAudio) {
            pages.push({ id: key.name, hasText, hasAudio });
          }
        }
        cursor = result.list_complete ? undefined : result.cursor;
      } while (cursor);
      return json({ success: true, pages, count: pages.length });
    }

    // ── DELETE USER ──
    if (action === 'delete-user') {
      if (!id) return json({ success: false, error: 'Missing id' }, 400);
      
      // Delete content from XMAS_CONTENT
      await env.XMAS_CONTENT.delete(id);
      
      // Delete password from PAGE_PASSWORDS
      await env.PAGE_PASSWORDS.delete(id);
      
      return json({ success: true });
    }

    return json({ success: false, error: 'Unknown action: ' + action }, 400);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
