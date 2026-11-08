import { validateSession } from '../lib/auth.js';

const DEFAULT_PUBLIC_URL = 'https://pub-aa80f5e009854a94b9bcd90cda60268c.r2.dev';
const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// Lists images from the public image bucket so the admin can choose one; listing needs an admin session.
export async function onRequestGet({ request, env }) {
  if (!await validateSession(env, request.headers.get('x-admin-session'))) {
    return reply({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!env.IMAGE_FILES) {
    return reply({ success: false, error: 'The image bucket is not connected yet.' }, 503);
  }
  const base = String(env.IMAGE_PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) return reply({ success: false, error: 'The image bucket address is invalid.' }, 503);

  const files = [];
  let cursor;
  try {
    do {
      const listing = await env.IMAGE_FILES.list({ cursor, limit: 500 });
      for (const item of listing.objects) {
        const lower = item.key.toLowerCase();
        if (!EXTENSIONS.some(extension => lower.endsWith(extension))) continue;
        const path = item.key.split('/').map(part =>
          encodeURIComponent(part).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('/');
        files.push({ key: item.key, url: base + '/' + path });
      }
      cursor = listing.truncated ? listing.cursor : null;
    } while (cursor);
  } catch {
    return reply({ success: false, error: 'The image list is unavailable.' }, 503);
  }
  files.sort((a, b) => a.key.localeCompare(b.key));
  return reply({ success: true, files });
}
