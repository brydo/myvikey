export async function onRequest(context) {
  const { request, env, next } = context;
  try {
    const url = new URL(request.url);
    const isLanding = url.pathname === '/foreverpets' || url.pathname === '/foreverpets/' || url.pathname === '/foreverpets/index.html';
    if (request.method === 'GET' && isLanding && (url.searchParams.get('id') || '').trim()) {
      const viewResp = await env.ASSETS.fetch(new URL('/foreverpets/view', url.origin));
      if (viewResp.ok) return viewResp;
    }
  } catch (e) {}
  return next();
}
