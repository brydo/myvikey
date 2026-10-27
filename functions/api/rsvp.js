import { validateSession, hashPassword, verifyPassword, generateSessionToken, checkRateLimit, recordFailedAttempt } from '../lib/auth.js';
import { eventTypes, theme, normalizeAppearance, validateAppearance, styleIssues } from '../../rsvp/themes.js';
import { validInvitationId, invitationId, generateInvitationId } from '../../rsvp/invitation-id.js';

const PREFIX = 'rsvp:';
const INVITATIONS = 'rsvp-invitation:';
const GUEST_SESSIONS = 'rsvp-guest-session:';
const validId = validInvitationId;

function invitationDTO(invitation, id) {
  const { title, text, whatsapp = '', sms = '' } = invitation;
  return { id, eventType: theme(invitation.eventType),
    title, text, whatsapp, sms, passwordProtected: !!invitation.guestPasswordHash };
}

async function guestAccess(env, request, invitation, id) {
  if (!invitation.guestPasswordHash) return true;
  const token = request.headers.get('x-rsvp-guest-token');
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !env.FORM_SUBMISSIONS) return false;
  const raw = await env.FORM_SUBMISSIONS.get(GUEST_SESSIONS + token);
  if (!raw) return false;
  const session = JSON.parse(raw);
  return !!invitation.guestPasswordHash && session.scope === 'rsvp-guest' && session.invitationId === id &&
    session.protection === invitation.guestPasswordHash && session.revision === invitation.guestPasswordRevision &&
    Number.isFinite(session.expiresAt) && session.expiresAt > Date.now();
}

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
  const reply = (data, status = 200, headers = {}) => Response.json(data, {
    status, headers: { ...headers, 'Cache-Control': 'no-store' }
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
  } else if (!['submit', 'get-invitation', 'unlock-invitation', 'get-appearance'].includes(body.action)) {
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
      let saved;
      if (body.action === 'save-appearance') {
        const { action, eventType, ...changes } = body;
        if (!eventTypes.includes(eventType) || !Object.prototype.hasOwnProperty.call(changes, 'backgroundImage')) {
          return reply({ success: false, error: 'Choose a category, a safe HTTPS image URL (maximum 2048 characters) or blank, plain text, and readable card colours (contrast at least 4.5:1).' }, 400);
        }
        // updatedAt is server-owned; never accept or carry it into validation.
        const { updatedAt, ...current } = await readAppearance(eventType);
        const candidate = { ...current, ...changes };
        for (const group of ['copy', 'cardStyle']) {
          if (changes[group] && typeof changes[group] === 'object' && !Array.isArray(changes[group])) {
            candidate[group] = { ...current[group], ...changes[group] };
          }
        }
        const merged = validateAppearance(eventType, candidate, changes.cardStyle);
        if (!merged) {
          const fields = candidate.cardStyle && typeof candidate.cardStyle === 'object' && !Array.isArray(candidate.cardStyle) ?
            styleIssues(eventType, candidate.cardStyle, changes.cardStyle) : [];
          return reply({ success: false, fields, error: fields.length ?
            'Not saved: ' + fields.map(issue => issue.message).join(' ') :
            'Use a safe HTTPS image URL (maximum 2048 characters) or blank, plain text, and valid card settings with text, heading and button label contrast of at least 4.5:1 and borders of at least 3:1.' }, 400);
        }
        saved = { ...merged, updatedAt: Math.max(Date.now(), updatedAt + 1) };
        await env.FORM_SUBMISSIONS.put('rsvp-appearance:' + eventType, JSON.stringify(saved));
      }
      const appearance = {};
      await Promise.all(eventTypes.map(async type => {
        // KV is eventually consistent, so return the value just written instead of re-reading it.
        appearance[type] = saved && type === body.eventType ? saved : await readAppearance(type);
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
      let id = body.id;
      if (!id) {
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = generateInvitationId();
          if (await env.FORM_SUBMISSIONS.get(INVITATIONS + candidate) === null) {
            id = candidate;
            break;
          }
        }
        if (!id) {
          return reply({ success: false, error: 'Unable to allocate a unique invitation code. Please try again.' }, 503);
        }
      }
      const raw = body.id ? await env.FORM_SUBMISSIONS.get(INVITATIONS + id) : null;
      if (body.id && !raw) {
        return reply({ success: false, error: 'Invitation not found' }, 404);
      }
      const invitation = { ...(raw ? JSON.parse(raw) : {}), id, ...fields };
      if ((body.guestPassword !== undefined && typeof body.guestPassword !== 'string') ||
          (body.removeGuestPassword !== undefined && typeof body.removeGuestPassword !== 'boolean') ||
          (body.removeGuestPassword && body.guestPassword)) {
        return reply({ success: false, error: 'Choose a new guest password or remove protection, not both.' }, 400);
      }
      if (body.guestPassword) {
        if ([...body.guestPassword].length < 8 || !body.guestPassword.trim() ||
            new TextEncoder().encode(body.guestPassword).length > 72) {
          return reply({ success: false, error: 'Guest passwords need at least 8 characters, including a non-space character, and at most 72 UTF-8 bytes. Blank keeps the existing password unchanged.' }, 400);
        }
        if (!env.RATE_LIMIT) {
          return reply({ success: false, error: 'Guest authentication is unavailable.' }, 503);
        }
        invitation.guestPasswordHash = await hashPassword(body.guestPassword);
        invitation.guestPasswordRevision = crypto.randomUUID();
      } else if (body.removeGuestPassword) {
        delete invitation.guestPasswordHash;
        invitation.guestPasswordRevision = crypto.randomUUID();
      }
      await env.FORM_SUBMISSIONS.put(INVITATIONS + id, JSON.stringify(invitation));
      return reply({ success: true, invitation: invitationDTO(invitation, id) });
    }
    if (body.action === 'get-invitation' || body.action === 'unlock-invitation') {
      const id = invitationId(body.id);
      if (!id) return reply({ success: false, error: 'Invalid invitation ID' }, 400);
      const raw = await env.FORM_SUBMISSIONS.get(INVITATIONS + id);
      if (!raw) return reply({ success: false, error: 'Invitation not found' }, 404);
      const invitation = JSON.parse(raw);
      if (body.action === 'unlock-invitation') {
        if (!env.RATE_LIMIT) {
          return reply({ success: false, error: 'Guest authentication is unavailable.' }, 503);
        }
        const bucket = 'rsvp-guest:' + (request.headers.get('CF-Connecting-IP') || 'unknown');
        const rateReply = limit => reply({ success: false, error: 'Too many failed attempts. Try again later.' },
          429, { 'Retry-After': String(Math.max(1, Math.ceil((limit.lockedUntil - Date.now()) / 1000))) });
        const limit = await checkRateLimit(env, bucket);
        if (!limit.allowed) return rateReply(limit);
        if (!invitation.guestPasswordHash || typeof body.password !== 'string' ||
            !body.password || new TextEncoder().encode(body.password).length > 72 ||
            !await verifyPassword(body.password, invitation.guestPasswordHash)) {
          const failed = await recordFailedAttempt(env, bucket);
          if (failed.lockedUntil) return rateReply(failed);
          return reply({ success: false, error: 'Incorrect guest password.' }, 401);
        }
        const token = generateSessionToken();
        const expiresAt = Date.now() + 30 * 60 * 1000;
        await env.FORM_SUBMISSIONS.put(GUEST_SESSIONS + token, JSON.stringify({
          scope: 'rsvp-guest', invitationId: id, protection: invitation.guestPasswordHash,
          revision: invitation.guestPasswordRevision, expiresAt
        }), { expirationTtl: 30 * 60 });
        return reply({ success: true, guestToken: token, expiresAt });
      }
      const admin = await validateSession(env, request.headers.get('x-admin-session'));
      if ((!admin || admin.userId !== '__admin__') && !await guestAccess(env, request, invitation, id)) {
        return reply({ success: false, passwordProtected: !!invitation.guestPasswordHash,
          error: 'Enter the guest password to open this invitation.' }, 401);
      }
      return reply({ success: true, invitation: invitationDTO(invitation, id) });
    }
    if (body.action === 'list' || body.action === 'list-invitations') {
      if (body.eventId !== undefined && body.eventId !== 'unassigned' && !validId(body.eventId)) {
        return reply({ success: false, error: 'Invalid invitation ID' }, 400);
      }
      const invitations = body.action === 'list-invitations';
      const page = await env.FORM_SUBMISSIONS.list({
        prefix: invitations ? INVITATIONS : PREFIX, limit: 50, cursor: body.cursor || undefined
      });
      const keys = invitations ? page.keys.filter(key => validId(key.name.slice(INVITATIONS.length))) : page.keys;
      const records = await Promise.all(keys.map(key => env.FORM_SUBMISSIONS.get(key.name)));
      let items = records.map((raw, index) => raw ?
        (invitations ? invitationDTO(JSON.parse(raw), keys[index].name.slice(INVITATIONS.length)) :
          { ...JSON.parse(raw), id: keys[index].name.slice(PREFIX.length) }) : null
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
    let canonicalId;
    if (body.eventId !== undefined) {
      canonicalId = invitationId(body.eventId);
      if (!canonicalId) return reply({ success: false, error: 'Invalid invitation ID' }, 400);
      const raw = await env.FORM_SUBMISSIONS.get(INVITATIONS + canonicalId);
      if (!raw) return reply({ success: false, error: 'Invitation not found' }, 404);
      invitation = JSON.parse(raw);
      if (!await guestAccess(env, request, invitation, canonicalId)) {
        return reply({ success: false, passwordProtected: !!invitation.guestPasswordHash,
          error: 'Enter the guest password before responding.' }, 401);
      }
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
      response.eventId = canonicalId;
      response.eventType = theme(invitation.eventType);
    }
    const key = PREFIX + crypto.randomUUID();
    await env.FORM_SUBMISSIONS.put(key, JSON.stringify(response));
    if (invitation) {
      let current, allowed = false;
      try {
        const currentRaw = await env.FORM_SUBMISSIONS.get(INVITATIONS + canonicalId);
        current = currentRaw ? JSON.parse(currentRaw) : null;
        allowed = current && current.guestPasswordHash === invitation.guestPasswordHash &&
          current.guestPasswordRevision === invitation.guestPasswordRevision &&
          await guestAccess(env, request, current, canonicalId);
      } finally {
        if (!allowed) await env.FORM_SUBMISSIONS.delete(key);
      }
      if (!allowed) {
        return reply({ success: false, passwordProtected: !!current?.guestPasswordHash,
          error: 'Invitation access changed. Reopen the invitation.' }, current ? 401 : 404);
      }
    }
    return reply({
      success: true, response,
      organiser: invitation ? { whatsapp: invitation.whatsapp || '', sms: invitation.sms || '' } : {}
    });
  } catch {
    return reply({ success: false, error: 'Unable to process RSVP. Please try again.' }, 500);
  }
}
