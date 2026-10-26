import { invitationId } from '../../rsvp/invitation-id.js';

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const match = /^\/rsvp\/i\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return next();
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  if (!invitationId(match[1]) || match[1].length !== 22) return new Response('Invitation not found', { status: 404 });
  try {
    let target = new URL('/rsvp/', url.origin);
    for (let i = 0; i < 4; i++) {
      const response = await env.ASSETS.fetch(new Request(target, { method: request.method, redirect: 'manual' }));
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (!location) break;
        target = new URL(location, target);
        if (target.origin !== url.origin || target.username || target.password ||
            !['/rsvp', '/rsvp/', '/rsvp/index.html'].includes(target.pathname)) break;
        continue;
      }
      if (response.ok) return response;
      break;
    }
  } catch { /* Do not expose asset errors. */ }
  return new Response('Invitation unavailable', { status: 503 });
}
