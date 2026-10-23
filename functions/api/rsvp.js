import { validateSession } from '../lib/auth.js';

const PREFIX = 'rsvp:';

export async function onRequestPost({ request, env }) {
  const reply = (data, status = 200) => Response.json(data, {
    status, headers: { 'Cache-Control': 'no-store' }
  });
  if (new URL(request.url).protocol !== 'https:') {
    return reply({ success: false, error: 'HTTPS required' }, 403);
  }
  let body;
  try { body = await request.json(); } catch {
    return reply({ success: false, error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply({ success: false, error: 'Invalid JSON' }, 400);
  }

  if (body.action === 'list') {
    if (!await validateSession(env, request.headers.get('x-admin-session'))) {
      return reply({ success: false, error: 'Unauthorized' }, 401);
    }
    if (body.cursor !== undefined && (typeof body.cursor !== 'string' || body.cursor.length > 2048)) {
      return reply({ success: false, error: 'Invalid cursor' }, 400);
    }
  } else if (body.action !== 'submit') {
    return reply({ success: false, error: 'Unknown action' }, 400);
  }

  if (!env.FORM_SUBMISSIONS) {
    return reply({ success: false, error: 'RSVP storage is unavailable. Please try again later.' }, 503);
  }
  try {
    if (body.action === 'list') {
      const page = await env.FORM_SUBMISSIONS.list({ prefix: PREFIX, limit: 50, cursor: body.cursor || undefined });
      const records = await Promise.all(page.keys.map(key => env.FORM_SUBMISSIONS.get(key.name)));
      return reply({
        success: true,
        responses: records.filter(Boolean).map(raw => JSON.parse(raw)),
        cursor: page.list_complete ? '' : page.cursor
      });
    }

    const response = {};
    for (const [field, max] of Object.entries({ name: 100, event: 100, notes: 1000 })) {
      const value = body[field] === undefined && field === 'notes' ? '' : body[field];
      if (typeof value !== 'string' || value.trim().length > max || (field !== 'notes' && !value.trim())) {
        return reply({ success: false, error: `${field} must be ${field === 'notes' ? 'at most' : '1 to'} ${max} characters` }, 400);
      }
      response[field] = value.trim();
    }
    if (!['yes', 'no'].includes(body.attending)) {
      return reply({ success: false, error: 'Attending must be Yes or No' }, 400);
    }
    if (!Number.isInteger(body.guests) || body.guests < 0 || body.guests > 100 ||
        (body.attending === 'no' && body.guests !== 0)) {
      return reply({ success: false, error: 'Guests must be a whole number from 0 to 100, or 0 if not attending' }, 400);
    }
    response.attending = body.attending;
    response.guests = body.guests;
    await env.FORM_SUBMISSIONS.put(PREFIX + crypto.randomUUID(), JSON.stringify(response));
    return reply({ success: true });
  } catch {
    return reply({ success: false, error: 'Unable to process RSVP. Please try again.' }, 500);
  }
}
