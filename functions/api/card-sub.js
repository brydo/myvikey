// functions/api/card-sub.js
// MyCard subcontractors: the admin gives a subcontractor a card allowance; they sign in with email + password,
// and see a read-only list of the cards the admin allocated to them: claimed or not, and the name on each claimed card.
// They never see card URLs, claim codes, emails or other customer details. The admin can switch them off at any time.
// Admin actions (X-Admin-Session): create, list, update, resend-invite, allocate
// Public actions: login, logout, forgot, reset
// Subcontractor actions (X-Sub-Session): me

import { hashPassword, verifyPassword, validateSession } from '../lib/auth.js';
import {
  cleanEmail, passwordProblem, readJson, sha256Hex, randomToken,
  isLimited, bump, sendEmail, listKeys, baseUrl, createCards
} from '../lib/card-owner.js';

const MAX_BATCH = 100;
const DEFAULT_BATCH_EMAIL = 'brydo@outlook.com';
const MAX_ALLOWANCE = 10000;
const SESSION_TTL_SEC = 30 * 60;
const INVITE_TTL_SEC = 3 * 24 * 3600;
const RESET_TTL_SEC = 30 * 60;
const HOUR = 3600;
const LOGIN_WINDOW = 15 * 60;

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400) => json({ success: false, error }, status);
const tooMany = () => fail('Too many attempts. Please try again later.', 429);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return /^application\/json/i.test(request.headers.get('content-type') || '');
}

const cleanName = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const cleanAllowance = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_ALLOWANCE ? n : null;
};

async function subSession(env, token) {
  if (!token || typeof token !== 'string') return null;
  const session = await readJson(env.CARD_PASSWORDS, 'subsession:' + await sha256Hex(token));
  if (!session || Date.now() > session.expiresAt) return null;
  const sub = await readJson(env.CARD_PASSWORDS, 'sub:' + session.id);
  if (!sub || !sub.enabled || (sub.version || 0) !== session.v) return null;
  return { id: session.id, sub };
}

async function sendSetupLink(env, sub, kind) {
  const token = randomToken();
  const invite = kind === 'invite';
  await env.CARD_PASSWORDS.put('subtoken:' + await sha256Hex(token), JSON.stringify({ id: sub.id, v: sub.version || 0 }),
    { expirationTtl: invite ? INVITE_TTL_SEC : RESET_TTL_SEC });
  const link = `${baseUrl(env)}/mycard/sub?reset=${token}`;
  return sendEmail(env, sub.email, invite ? 'Your V I Key® MyCard subcontractor account' : 'Reset your MyCard subcontractor password',
    invite
      ? `<p>Hello ${esc(sub.name)}, you have been given a MyCard subcontractor account.</p><p><a href="${link}">Choose your password</a></p><p>This link works once and expires in 3 days.</p>`
      : `<p>Use this link to choose a new password.</p><p><a href="${link}">Reset my password</a></p><p>It works once and expires in 30 minutes. If you did not ask for this, ignore this email.</p>`);
}

async function usage(store, id) {
  return (await listKeys(store, 'subcard:' + id + ':')).length;
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

  switch (action) {
    case 'create':
    case 'list':
    case 'update':
    case 'resend-invite':
    case 'allocate': {
      if (!await validateSession(env, request.headers.get('x-admin-session'))) return fail('Unauthorized', 401);

      if (action === 'list') {
        const ids = await listKeys(store, 'sub:');
        const subs = await Promise.all(ids.map(async (id) => {
          const s = await readJson(store, 'sub:' + id);
          if (!s) return null;
          return { id, name: s.name, email: s.email, enabled: !!s.enabled, allowance: s.allowance,
            used: await usage(store, id), passwordSet: !!s.passwordHash, hasLogo: !!s.hasLogo, logoV: s.logoV || '', created: s.created };
        }));
        return json({ success: true, subs: subs.filter(Boolean).sort((a, b) => String(b.created).localeCompare(String(a.created))) });
      }

      if (action === 'create') {
        const name = cleanName(body.name);
        const email = cleanEmail(body.email);
        const allowance = cleanAllowance(body.allowance);
        if (!name || name.length > 80) return fail('Enter a name (up to 80 characters)');
        if (!email) return fail('Enter a valid email address');
        if (!allowance) return fail(`Enter a card allowance from 1 to ${MAX_ALLOWANCE}`);
        if (await store.get('subemail:' + email)) return fail('A subcontractor with that email already exists');
        const id = 'sub-' + randomToken().slice(0, 8);
        const sub = { id, name, email, allowance, enabled: true, version: 0, passwordHash: '', created: new Date().toISOString() };
        await store.put('sub:' + id, JSON.stringify(sub));
        await store.put('subemail:' + email, id);
        const emailed = await sendSetupLink(env, sub, 'invite');
        return json({ success: true, id, emailed });
      }

      const id = typeof body.id === 'string' ? body.id : '';
      const sub = /^sub-[0-9a-f]{8}$/.test(id) ? await readJson(store, 'sub:' + id) : null;
      if (!sub) return fail('Subcontractor not found', 404);

      if (action === 'resend-invite') {
        return json({ success: true, emailed: await sendSetupLink(env, sub, 'invite') });
      }

      if (action === 'allocate') {
        const count = Number(body.count);
        const remaining = Math.max(0, sub.allowance - await usage(store, id));
        if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) return fail(`Enter a number from 1 to ${MAX_BATCH}`);
        if (count > remaining) return fail(`${sub.name} has ${remaining} card${remaining === 1 ? '' : 's'} left in their allowance. Raise the allowance first.`);
        const cards = await createCards(env, count, id);
        const to = env.BATCH_EMAIL_TO || DEFAULT_BATCH_EMAIL;
        const csv = 'Card ID,URL,Claim code\n' + cards.map((c) => `${c.id},${c.url},${c.code}`).join('\n') + '\n';
        const rows = cards.map((c) => `<tr><td>${c.id}</td><td>${c.url}</td><td><b>${c.code}</b></td></tr>`).join('');
        const emailed = await sendEmail(env, to, `MyCard: ${count} cards for ${sub.name}`,
          `<p>${count} new MyCard${count === 1 ? '' : 's'} allocated to ${esc(sub.name)}. Keep this email private: each claim code lets its holder take over that card.</p>` +
          `<table border="1" cellpadding="6" cellspacing="0"><tr><th>Card ID</th><th>URL</th><th>Claim code</th></tr>${rows}</table>`,
          [{ filename: 'mycard-batch.csv', content: btoa(csv) }]);
        return json({ success: true, cards, emailed, emailedTo: emailed ? to : '', remaining: remaining - count });
      }

      if (body.name !== undefined) {
        const name = cleanName(body.name);
        if (!name || name.length > 80) return fail('Enter a name (up to 80 characters)');
        sub.name = name;
      }
      if (body.allowance !== undefined) {
        const allowance = cleanAllowance(body.allowance);
        if (!allowance) return fail(`Enter a card allowance from 1 to ${MAX_ALLOWANCE}`);
        sub.allowance = allowance;
      }
      if (body.enabled !== undefined) sub.enabled = body.enabled === true;
      await store.put('sub:' + id, JSON.stringify(sub));
      return json({ success: true });
    }

    case 'login': {
      const email = cleanEmail(body.email);
      if (!email || typeof body.password !== 'string') return fail('Email and password are required');
      if (await isLimited(env, 'sub:login:ip:' + ip, 20) || await isLimited(env, 'sub:login:e:' + email, 8)) return tooMany();
      const id = await store.get('subemail:' + email);
      const sub = id ? await readJson(store, 'sub:' + id) : null;
      const ok = !!sub && sub.enabled && !!sub.passwordHash && await verifyPassword(body.password, sub.passwordHash);
      if (!ok) {
        await bump(env, 'sub:login:ip:' + ip, LOGIN_WINDOW);
        await bump(env, 'sub:login:e:' + email, LOGIN_WINDOW);
        return fail('Incorrect email or password.', 401);
      }
      const token = randomToken();
      const expiresAt = Date.now() + SESSION_TTL_SEC * 1000;
      await store.put('subsession:' + await sha256Hex(token), JSON.stringify({ id, v: sub.version || 0, expiresAt }),
        { expirationTtl: SESSION_TTL_SEC });
      return json({ success: true, sessionToken: token, expiresAt });
    }

    case 'logout': {
      const token = request.headers.get('x-sub-session');
      if (token) await store.delete('subsession:' + await sha256Hex(token));
      return json({ success: true });
    }

    case 'forgot': {
      const email = cleanEmail(body.email);
      if (await isLimited(env, 'sub:forgot:ip:' + ip, 5)) return tooMany();
      await bump(env, 'sub:forgot:ip:' + ip, HOUR);
      if (email && !await isLimited(env, 'sub:forgot:e:' + email, 3)) {
        await bump(env, 'sub:forgot:e:' + email, HOUR);
        const id = await store.get('subemail:' + email);
        const sub = id ? await readJson(store, 'sub:' + id) : null;
        if (sub && sub.enabled) await sendSetupLink(env, sub, 'reset');
      }
      return json({ success: true });
    }

    case 'reset': {
      if (typeof body.token !== 'string' || !body.token) return fail('Invalid or expired link');
      const problem = passwordProblem(body.password);
      if (problem) return fail(problem);
      if (await isLimited(env, 'sub:reset:ip:' + ip, 20)) return tooMany();
      await bump(env, 'sub:reset:ip:' + ip, HOUR);
      const key = 'subtoken:' + await sha256Hex(body.token);
      const pending = await readJson(store, key);
      const sub = pending ? await readJson(store, 'sub:' + pending.id) : null;
      if (!sub || (sub.version || 0) !== pending.v) return fail('This link is invalid or has expired.');
      await store.delete(key);
      sub.passwordHash = await hashPassword(body.password.trim());
      sub.version = (sub.version || 0) + 1;
      await store.put('sub:' + sub.id, JSON.stringify(sub));
      return json({ success: true });
    }

    case 'me': {
      const auth = await subSession(env, request.headers.get('x-sub-session'));
      if (!auth) return fail('Please sign in again.', 401);
      const { id: subId, sub } = auth;
      const ids = await listKeys(store, 'subcard:' + subId + ':');
      const cards = await Promise.all(ids.map(async (id) => {
        const claimed = !!await store.get('owner:' + id);
        let name = '';
        if (claimed) {
          try { name = String(JSON.parse(await env.CARD_CONTENT.get(id)).name || ''); } catch { /* no details saved yet */ }
        }
        return { id, claimed, name, allocated: await store.get('subcard:' + subId + ':' + id) || '' };
      }));
      cards.sort((a, b) => String(b.allocated).localeCompare(String(a.allocated)));
      return json({ success: true, name: sub.name, allocated: cards.length, claimed: cards.filter((c) => c.claimed).length, cards });
    }

    default:
      return fail('Unknown action');
  }
}
