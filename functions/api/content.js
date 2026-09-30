

export async function onRequestPost(context) {
  var request = context.request;
  var env = context.env;
  try {
    var body = await request.json();
    var action = body.action;

    if (action === 'set-content') {
      var id = body.id;
      if (!id) return json({ success: false, error: 'No ID provided' });
      var content = {
        name: body.name || '',
        photoUrl: body.photoUrl || '',
        text: body.text || '',
        audioUrl: body.audioUrl || '',
        updated: new Date().toISOString()
      };
      await env.MEMORIAL_CONTENT.put(id, JSON.stringify(content));
      return json({ success: true });
    }

    if (action === 'get-content') {
      var id = body.id;
      if (!id) return json({ success: false, error: 'No ID provided' });
      var raw = await env.MEMORIAL_CONTENT.get(id);
      if (!raw) return json({ success: true, content: null });
      var content = JSON.parse(raw);
      return json({ success: true, content: content });
    }

    if (action === 'delete-content') {
      var id = body.id;
      if (!id) return json({ success: false, error: 'No ID provided' });
      await env.MEMORIAL_CONTENT.delete(id);
      return json({ success: true });
    }

    if (action === 'list-content') {
      var list = await env.MEMORIAL_CONTENT.list();
      var pages = list.keys.map(function(key) {
        return { id: key.name };
      });
      return json({ success: true, pages: pages, count: pages.length });
    }

    return json({ success: false, error: 'Unknown action' });
  } catch (e) {
    return json({ success: false, error: e.message });
  }
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { 'Content-Type': 'application/json' }
  });
}