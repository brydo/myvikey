// Canonical host: bounce the Cloudflare preview domain (and any other
// non-production host) to the real site, preserving path and query.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname.endsWith('.pages.dev')) {
    const target = new URL(url.pathname + url.search + url.hash, 'https://vi-key.uk');
    return Response.redirect(target.toString(), 301);
  }
  return next();
}
