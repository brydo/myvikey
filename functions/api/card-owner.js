// functions/api/card-owner.js
// MyCard owner accounts: claim a card with a code, confirm the email, sign in,
// and reset a forgotten password by email.
// Public actions: claim, verify-email, login, logout, forgot, reset
// Admin actions (X-Admin-Session): create-claim, owner-status, remove-owner

import { hashPassword, verifyPassword, validateSession } from '../lib/auth.js';
import {
  cleanCardId, cleanEmail, passwordProblem, readJson, sha256Hex, randomToken,
  generateClaimCode, claimHash, createOwnerSession, isLimited, bump, sendEmail, parseClaim, listKeys,
  newCardId, baseUrl, createCards
} from '../lib/card-owner.js';

const MAX_BATCH = 100;
const DEFAULT_BATCH_EMAIL = 'brydo@outlook.com';
const VERIFY_TTL_SEC = 60 * 60;
const RESET_TTL_SEC = 30 * 60;
const HOUR = 3600;
const LOGIN_WINDOW = 15 * 60;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
const fail = (error, status = 400) => json({ success: false, error }, status);
const tooMany = () => fail('Too many attempts. Please try again later.', 429);

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return /^application\/json/i.test(request.headers.get('content-type') || '');
}

// Name of the subcontractor a card was issued to, if any.
async function subName(store, cardId) {
  const subId = await store.get('cardsub:' + cardId);
  const sub = subId ? await readJson(store, 'sub:' + subId) : null;
  return sub ? sub.name : '';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return fail('Cross-origin request rejected', 403);

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON'); }
  if (!body || typeof body !== 'object') return fail('Invalid JSON');

  const store = env.CARD_PASSWORDS;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const action = body.action;
  const id = cleanCardId(body.id);

  switch (action) {
    case 'create-claim':
    case 'create-batch':
    case 'owner-status':
    case 'list-owners':
    case 'remove-owner': {
      if (!await validateSession(env, request.headers.get('x-admin-session'))) return fail('Unauthorized', 401);

      if (action === 'list-owners') {
        const [owned, pending] = await Promise.all([listKeys(store, 'owner:'), listKeys(store, 'claim:')]);
        const owners = await Promise.all(owned.map(async (cardId) => {
          const o = await readJson(store, 'owner:' + cardId);
          return { id: cardId, email: o ? o.email : '', created: o ? o.created || '' : '', sub: await subName(store, cardId) };
        }));
        const unclaimed = await Promise.all(pending.map(async (cardId) => {
          const c = parseClaim(await store.get('claim:' + cardId));
          return { id: cardId, created: c ? c.created : '', sub: await subName(store, cardId) };
        }));
        const byDate = (a, b) => String(b.created).localeCompare(String(a.created));
        return json({ success: true, claimed: owners.sort(byDate), unclaimed: unclaimed.sort(byDate) });
      }

      if (action === 'create-batch') {
        const count = Number(body.count);
        if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) return fail(`Enter a number from 1 to ${MAX_BATCH}`);
        const created = new Date().toISOString();
        const cards = await createCards(env, count);
        const to = env.BATCH_EMAIL_TO || DEFAULT_BATCH_EMAIL;
        const csv = 'Card ID,URL,Claim code\n' + cards.map((c) => `${c.id},${c.url},${c.code}`).join('\n') + '\n';
        const rows = cards.map((c) => `<tr><td>${c.id}</td><td>${c.url}</td><td><b>${c.code}</b></td></tr>`).join('');
        const emailed = await sendEmail(env, to, `MyCard batch of ${count} (${created.slice(0, 10)})`,
          `<p>${count} new MyCard${count === 1 ? '' : 's'} created. Keep this email private: each claim code lets its holder take over that card.</p>` +
          `<table border="1" cellpadding="6" cellspacing="0"><tr><th>Card ID</th><th>URL</th><th>Claim code</th></tr>${rows}</table>`,
          [{ filename: 'mycard-batch.csv', content: btoa(csv) }]);
        return json({ success: true, cards, emailed, emailedTo: emailed ? to : '' });
      }

      if (action === 'create-claim' && !body.id) {
        const code = generateClaimCode();
        let cardId = newCardId();
        while (await store.get('claim:' + cardId) || await store.get('owner:' + cardId) || await env.CARD_CONTENT.get(cardId)) cardId = newCardId();
        await store.put('claim:' + cardId, JSON.stringify({ h: await claimHash(cardId, code), created: new Date().toISOString() }));
        return json({ success: true, id: cardId, code });
      }

      if (!id) return fail('Page ID is required');
      const owner = await readJson(store, 'owner:' + id);
      if (action === 'owner-status') {
        return json({ success: true, claimed: !!owner, email: owner ? owner.email : '',
          claimPending: !!await store.get('claim:' + id) });
      }
      if (action === 'remove-owner') {
        await store.delete('owner:' + id);
        await store.delete('claim:' + id);
        return json({ success: true });
      }
      if (owner) return fail('This card has already been claimed. Remove the owner first to issue a new code.');
      // Issuing a new code replaces any earlier one for this card.
      const code = generateClaimCode();
      await store.put('claim:' + id, JSON.stringify({ h: await claimHash(id, code), created: new Date().toISOString() }));
      return json({ success: true, id, code });
    }

    case 'claim': {
      const email = cleanEmail(body.email);
      const problem = passwordProblem(body.password);
      if (!id || !body.code) return fail('Card ID and claim code are required');
      if (!email) return fail('Enter a valid email address');
      if (problem) return fail(problem);
      if (await isLimited(env, 'own:claim:ip:' + ip, 10) || await isLimited(env, 'own:claim:id:' + id, 10)) return tooMany();

      const expected = parseClaim(await store.get('claim:' + id));
      const given = await claimHash(id, body.code);
      if (!expected || expected.h !== given) {
        await bump(env, 'own:claim:ip:' + ip, HOUR);
        await bump(env, 'own:claim:id:' + id, HOUR);
        return fail('That Card ID and claim code do not match.', 401);
      }
      if (await store.get('owner:' + id)) return fail('That Card ID and claim code do not match.', 401);

      const token = randomToken();
      await store.put('verify:' + await sha256Hex(token), JSON.stringify({
        id, email, passwordHash: await hashPassword(body.password.trim()), claim: given
      }), { expirationTtl: VERIFY_TTL_SEC });
      await bump(env, 'own:claim:ip:' + ip, HOUR);
      const link = `${baseUrl(env)}/mycard/owner?verify=${token}`;
      const sent = await sendEmail(env, email, 'Confirm your MyCard email',
        `<p>Confirm this email address to finish setting up your V I Key® MyCard.</p>` +
        `<p><a href="${link}">Confirm my email</a></p>` +
        `<p>This link works once and expires in 1 hour. If you did not request this, ignore this email.</p>`);
      if (!sent) return fail('We could not send the confirmation email. Please try again later.', 502);
      return json({ success: true });
    }

    case 'verify-email': {
      if (typeof body.token !== 'string' || !body.token) return fail('Invalid or expired link');
      if (await isLimited(env, 'own:verify:ip:' + ip, 20)) return tooMany();
      await bump(env, 'own:verify:ip:' + ip, HOUR);
      const key = 'verify:' + await sha256Hex(body.token);
      const pending = await readJson(store, key);
      if (!pending) return fail('This link is invalid or has expired.', 400);
      await store.delete(key);
      const current = parseClaim(await store.get('claim:' + pending.id));
      if (!current || current.h !== pending.claim || await store.get('owner:' + pending.id)) {
        return fail('This card can no longer be claimed with that link.', 400);
      }
      await store.put('owner:' + pending.id, JSON.stringify({
        email: pending.email, passwordHash: pending.passwordHash, version: 0, created: new Date().toISOString()
      }));
      await store.delete('claim:' + pending.id);
      return json({ success: true, id: pending.id });
    }

    case 'login': {
      if (!id || typeof body.password !== 'string') return fail('Card ID and password are required');
      if (await isLimited(env, 'own:login:ip:' + ip, 20) || await isLimited(env, 'own:login:id:' + id, 8)) return tooMany();
      const owner = await readJson(store, 'owner:' + id);
      if (owner && await verifyPassword(body.password.trim(), owner.passwordHash)) {
        const session = await createOwnerSession(env, id, owner.version || 0);
        return json({ success: true, sessionToken: session.token, expiresAt: session.expiresAt, id });
      }
      await bump(env, 'own:login:ip:' + ip, LOGIN_WINDOW);
      await bump(env, 'own:login:id:' + id, LOGIN_WINDOW);
      return fail('Incorrect card ID or password.', 401);
    }

    case 'logout': {
      const token = request.headers.get('x-owner-session');
      if (token) await store.delete('session:' + await sha256Hex(token));
      return json({ success: true });
    }

    case 'forgot': {
      // Same reply whatever happens, so this cannot be used to find out who is registered.
      const reply = () => json({ success: true });
      const email = cleanEmail(body.email);
      if (!id || !email) return reply();
      if (await isLimited(env, 'own:forgot:ip:' + ip, 5) || await isLimited(env, 'own:forgot:id:' + id, 3)) return reply();
      await bump(env, 'own:forgot:ip:' + ip, HOUR);
      await bump(env, 'own:forgot:id:' + id, HOUR);
      const owner = await readJson(store, 'owner:' + id);
      if (owner && owner.email === email) {
        const token = randomToken();
        await store.put('reset:' + await sha256Hex(token), JSON.stringify({ id }), { expirationTtl: RESET_TTL_SEC });
        const link = `${baseUrl(env)}/mycard/owner?reset=${token}`;
        await sendEmail(env, owner.email, 'Reset your MyCard password',
          `<p>Use this link to choose a new password for your V I Key® MyCard.</p>` +
          `<p><a href="${link}">Reset my password</a></p>` +
          `<p>This link works once and expires in 30 minutes. If you did not ask for this, ignore this email.</p>`);
      }
      return reply();
    }

    case 'reset': {
      if (typeof body.token !== 'string' || !body.token) return fail('Invalid or expired link');
      const problem = passwordProblem(body.password);
      if (problem) return fail(problem);
      if (await isLimited(env, 'own:reset:ip:' + ip, 10)) return tooMany();
      await bump(env, 'own:reset:ip:' + ip, HOUR);
      const key = 'reset:' + await sha256Hex(body.token);
      const pending = await readJson(store, key);
      if (!pending) return fail('This link is invalid or has expired.', 400);
      await store.delete(key);
      const owner = await readJson(store, 'owner:' + pending.id);
      if (!owner) return fail('This link is invalid or has expired.', 400);
      owner.passwordHash = await hashPassword(body.password.trim());
      owner.version = (owner.version || 0) + 1; // signs out every existing session
      await store.put('owner:' + pending.id, JSON.stringify(owner));
      return json({ success: true, id: pending.id });
    }

    default:
      return fail('Unknown action');
  }
}
