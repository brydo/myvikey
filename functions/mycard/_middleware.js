export async function onRequest(context) {
  const { request, env, next } = context;
  try {
    const url = new URL(request.url);
    const isLanding = url.pathname === '/mycard' || url.pathname === '/mycard/' || url.pathname === '/mycard/index.html';
    if (request.method === 'GET' && isLanding && (url.searchParams.get('id') || '').trim()) {
      // Serve the card viewer in place (follow any Pages pretty-URL redirects) so the URL stays /mycard/?id=<id>
      let target = new URL('/mycard/view', url.origin);
      for (let i = 0; i < 3; i++) {
        const viewResp = await env.ASSETS.fetch(new Request(target, { method: 'GET' }));
        if (viewResp.status >= 300 && viewResp.status < 400 && viewResp.headers.get('Location')) {
          target = new URL(viewResp.headers.get('Location'), target);
          continue;
        }
        if (viewResp.ok) return viewResp;
        break;
      }
    }
  } catch (e) { console.error('mycard middleware error', e); }
  return next();
}
