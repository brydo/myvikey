import { invitationId } from '../../rsvp/invitation-id.js';

const HOST_LOGIN = /^\/rsvp\/(?:(?:(?:wedding|event|engagement|celebration)s?|party|parties)\/)?hostlogin\/?$/;

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const hostLogin = HOST_LOGIN.test(url.pathname);
  const match = /^\/rsvp\/i\/([^/]+)\/?$/.exec(url.pathname);
  if (!match && !hostLogin) return next();
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  if (!hostLogin && !invitationId(match[1])) return new Response('Invitation not found', { status: 404 });
  const entry = hostLogin ? '/rsvp/host' : '/rsvp/';
  const allowed = hostLogin ? ['/rsvp/host', '/rsvp/host.html'] : ['/rsvp', '/rsvp/', '/rsvp/index.html'];
  try {
    let target = new URL(entry, url.origin);
    for (let i = 0; i < 4; i++) {
      const response = await env.ASSETS.fetch(new Request(target, { method: request.method, redirect: 'manual' }));
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (!location) break;
        target = new URL(location, target);
        if (target.origin !== url.origin || target.username || target.password ||
            !allowed.includes(target.pathname)) break;
        continue;
      }
      if (response.ok) return response;
      break;
    }
  } catch { /* Do not expose asset errors. */ }
  return new Response(hostLogin ? 'Host login unavailable' : 'Invitation unavailable', { status: 503 });
}
