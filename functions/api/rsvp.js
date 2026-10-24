import { validateSession } from '../lib/auth.js';
import { eventTypes, theme, normalizeAppearance, validateAppearance } from '../../rsvp/themes.js';

const PREFIX = 'rsvp:';
const INVITATIONS = 'rsvp-invitation:';
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

function invitationFields(body) {
  const result = {};
  const eventType = body.eventType === undefined ? 'celebration' : body.eventType;
  if (!eventTypes.includes(eventType)) return null;
  result.eventType = eventType;
  for (const [field, max] of Object.entries({ title: 100, text: 5000, whatsapp: 16, sms: 16 })) {
    const value = ['whatsapp', 'sms'].includes(field) && body[field] === undefined ? '' : body[field];
    if (typeof value !== 'string' || value.trim().length > max) return null;
    result[field] = value.trim();
  }
  if (!result.title || !result.text) return null;
  if (result.whatsapp && !/^\+[1-9]\d{7,14}$/.test(result.whatsapp)) return null;
  if (result.sms && !/^\+[1-9]\d{7,14}$/.test(result.sms)) return null;
  return result;
}

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

  if (['list', 'list-invitations', 'save-invitation', 'save-appearance', 'delete-reply', 'delete-event'].includes(body.action)) {
    const session = await validateSession(env, request.headers.get('x-admin-session'));
    if (!session || session.userId !== '__admin__') {
      return reply({ success: false, error: 'Unauthorized' }, 401);
    }
    if (body.cursor !== undefined && (typeof body.cursor !== 'string' || body.cursor.length > 2048)) {
      return reply({ success: false, error: 'Invalid cursor' }, 400);
    }
  } else if (!['submit', 'get-invitation', 'get-appearance'].includes(body.action)) {
    return reply({ success: false, error: 'Unknown action' }, 400);
  }

  if (!env.FORM_SUBMISSIONS) {
    return reply({ success: false, error: 'RSVP storage is unavailable. Please try again later.' }, 503);
  }
  try {
    if (body.action === 'save-appearance' || body.action === 'get-appearance') {
      const readAppearance = async type => {
        const raw = await env.FORM_SUBMISSIONS.get('rsvp-appearance:' + type);
        let value;
        try { value = raw ? JSON.parse(raw) : undefined; } catch { /* Ignore malformed stored settings. */ }
        return normalizeAppearance(type, value);
      };
      if (body.action === 'save-appearance') {
        const { action, eventType, ...changes } = body;
        if (!eventTypes.includes(eventType) || !Object.prototype.hasOwnProperty.call(changes, 'backgroundImage')) {
          return reply({ success: false, error: 'Choose a category, a safe HTTPS image URL (maximum 2048 characters) or blank, plain text, and readable card colours (contrast at least 4.5:1).' }, 400);
        }
        const current = await readAppearance(eventType);
        const candidate = { ...current, ...changes };
        for (const group of ['copy', 'cardStyle']) {
          if (changes[group] && typeof changes[group] === 'object' && !Array.isArray(changes[group])) {
            candidate[group] = { ...current[group], ...changes[group] };
          }
        }
        const merged = validateAppearance(eventType, candidate);
        if (!merged) return reply({ success: false, error: 'Use a safe HTTPS image URL (maximum 2048 characters) or blank, plain text, and valid card settings with text and heading contrast of at least 4.5:1.' }, 400);
        await env.FORM_SUBMISSIONS.put('rsvp-appearance:' + eventType, JSON.stringify(merged));
      }
      const appearance = {};
      await Promise.all(eventTypes.map(async type => {
        appearance[type] = await readAppearance(type);
      }));
      return reply({ success: true, appearance });
    }
    if (body.action === 'delete-reply') {
      if (typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.id)) {
        return reply({ success: false, error: 'Invalid reply ID' }, 400);
      }
      await env.FORM_SUBMISSIONS.delete(PREFIX + body.id);
      return reply({ success: true });
    }
    if (body.action === 'delete-event') {
      if (!validId(body.id) || typeof body.deleteReplies !== 'boolean') {
        return reply({ success: false, error: 'Choose an event and whether to delete its replies' }, 400);
      }
      // Remove the invitation first so guests cannot submit more replies during cleanup.
      await env.FORM_SUBMISSIONS.delete(INVITATIONS + body.id);
      let cursor = '';
      if (body.deleteReplies) {
        const page = await env.FORM_SUBMISSIONS.list({
          prefix: PREFIX, limit: 50, cursor: body.cursor || undefined
        });
        const records = await Promise.all(page.keys.map(key => env.FORM_SUBMISSIONS.get(key.name)));
        await Promise.all(page.keys.filter((key, index) =>
          records[index] && JSON.parse(records[index]).eventId === body.id
        ).map(key => env.FORM_SUBMISSIONS.delete(key.name)));
        cursor = page.list_complete ? '' : page.cursor;
      }
      return reply({ success: true, cursor });
    }
    if (body.action === 'save-invitation') {
      const fields = invitationFields(body);
      if (!fields || (body.id !== undefined && !validId(body.id))) {
        return reply({ success: false, error: 'Enter a title, invitation text, and valid WhatsApp/text numbers in +countrycode format.' }, 400);
      }
      const id = body.id || crypto.randomUUID();
      if (body.id && !await env.FORM_SUBMISSIONS.get(INVITATIONS + id)) {
        return reply({ success: false, error: 'Invitation not found' }, 404);
      }
      const invitation = { id, ...fields };
      await env.FORM_SUBMISSIONS.put(INVITATIONS + id, JSON.stringify(invitation));
      return reply({ success: true, invitation });
    }
    if (body.action === 'get-invitation') {
      if (!validId(body.id)) return reply({ success: false, error: 'Invalid invitation ID' }, 400);
      const raw = await env.FORM_SUBMISSIONS.get(INVITATIONS + body.id);
      if (!raw) return reply({ success: false, error: 'Invitation not found' }, 404);
      return reply({ success: true, invitation: JSON.parse(raw) });
    }
    if (body.action === 'list' || body.action === 'list-invitations') {
      if (body.eventId !== undefined && body.eventId !== 'unassigned' && !validId(body.eventId)) {
        return reply({ success: false, error: 'Invalid invitation ID' }, 400);
      }
      const invitations = body.action === 'list-invitations';
      const page = await env.FORM_SUBMISSIONS.list({
        prefix: invitations ? INVITATIONS : PREFIX, limit: 50, cursor: body.cursor || undefined
      });
      const records = await Promise.all(page.keys.map(key => env.FORM_SUBMISSIONS.get(key.name)));
      let items = records.map((raw, index) => raw ?
        { ...JSON.parse(raw), ...(!invitations ? { id: page.keys[index].name.slice(PREFIX.length) } : {}) } : null
      ).filter(Boolean);
      if (!invitations && body.eventId !== undefined) {
        items = items.filter(item => body.eventId === 'unassigned' ? !item.eventId : item.eventId === body.eventId);
      }
      if (!invitations) {
        const categories = new Map();
        await Promise.all([...new Set(items.map(item => item.eventId).filter(validId))].map(async id => {
          const raw = await env.FORM_SUBMISSIONS.get(INVITATIONS + id);
          if (raw) categories.set(id, theme(JSON.parse(raw).eventType));
        }));
        items = items.map(item => ({
          ...item, eventType: categories.get(item.eventId) || theme(item.eventType)
        }));
      }
      return reply({
        success: true,
        [invitations ? 'invitations' : 'responses']: items,
        cursor: page.list_complete ? '' : page.cursor
      });
    }

    let invitation;
    if (body.eventId !== undefined) {
      if (!validId(body.eventId)) return reply({ success: false, error: 'Invalid invitation ID' }, 400);
      const raw = await env.FORM_SUBMISSIONS.get(INVITATIONS + body.eventId);
      if (!raw) return reply({ success: false, error: 'Invitation not found' }, 404);
      invitation = JSON.parse(raw);
      if (body.event !== invitation.title) {
        return reply({ success: false, error: 'The event has changed. Reload the invitation before responding.' }, 400);
      }
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
    response.createdAt = new Date().toISOString();
    if (invitation) {
      response.eventId = invitation.id;
      response.eventType = theme(invitation.eventType);
    }
    const key = PREFIX + crypto.randomUUID();
    await env.FORM_SUBMISSIONS.put(key, JSON.stringify(response));
    if (invitation && !await env.FORM_SUBMISSIONS.get(INVITATIONS + invitation.id)) {
      await env.FORM_SUBMISSIONS.delete(key);
      return reply({ success: false, error: 'Invitation not found' }, 404);
    }
    return reply({
      success: true, response,
      organiser: invitation ? { whatsapp: invitation.whatsapp || '', sms: invitation.sms || '' } : {}
    });
  } catch {
    return reply({ success: false, error: 'Unable to process RSVP. Please try again.' }, 500);
  }
}
