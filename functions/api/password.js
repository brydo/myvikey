

export async function onRequestPost(context) {
  var request = context.request;
  var env = context.env;
  try {
    var body = await request.json();
    var action = body.action;

    if (action === 'set') {
      var id = body.id;
      var password = body.password;
      if (!id || !password) return json({ success: false, error: 'Missing ID or password' });
      await env.MEMORIAL_PASSWORDS.put(id, password);
      return json({ success: true });
    }

    if (action === 'delete') {
      var id = body.id;
      if (!id) return json({ success: false, error: 'No ID provided' });
      await env.MEMORIAL_PASSWORDS.delete(id);
      return json({ success: true });
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