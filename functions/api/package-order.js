/* ============================================================
   V I Key® — Order Form API Handler
   Receives order requests from the package order pages
   Saves to FORM_SUBMISSIONS KV and sends email via Resend
   ============================================================ */

const ORDER_PREFIX = 'order:';
const validEventTypes = ['celebration', 'events', 'weddings', 'parties', 'engagements'];

function reply(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function validateOrder(body) {
  if (!body || typeof body !== 'object') return null;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const eventDate = typeof body.eventDate === 'string' ? body.eventDate.trim() : '';
  const eventType = typeof body.eventType === 'string' ? body.eventType : '';
  const pkg = typeof body.package === 'string' ? body.package.trim() : '';
  const cardCount = Number(body.cardCount) || 0;
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!name || name.length > 200) return null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return null;
  if (phone && phone.length > 32) return null;
  if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  if (!validEventTypes.includes(eventType)) return null;
  if (!pkg || pkg.length > 50) return null;
  if (!Number.isInteger(cardCount) || cardCount < 0 || cardCount > 100000) return null;
  if (message.length > 5000) return null;

  return { name, email, phone, eventDate, eventType, package: pkg, cardCount, message };
}

async function sendNotification(env, order) {
  if (!env.RESEND_API_KEY) return false;

  const eventLabels = {
    weddings: 'Wedding', engagements: 'Engagement',
    parties: 'Party', events: 'Event', celebration: 'Celebration'
  };
  const label = eventLabels[order.eventType] || order.eventType;

  const html = `
    <h2>New ${label} Package Order</h2>
    <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Name:</td><td>${order.name}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Email:</td><td>${order.email}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Phone:</td><td>${order.phone || '—'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Event date:</td><td>${order.eventDate || '—'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Package:</td><td>${order.package}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Cards:</td><td>${order.cardCount}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Message:</td><td>${order.message || '—'}</td></tr>
    </table>
    <p style="font-family:sans-serif;font-size:13px;color:#888;">Saved to KV under order key. Reply to the customer within 24 hours.</p>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'V I Key® Orders <orders@vi-key.uk>',
        to: ['brydo@outlook.com'],
        subject: `New ${label} order — ${order.name} (${order.package}, ${order.cardCount} cards)`,
        html
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  if (new URL(request.url).protocol !== 'https:') {
    return reply({ success: false, error: 'HTTPS required' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ success: false, error: 'Invalid JSON' }, 400);
  }

  if (body.action !== 'submit-order') {
    return reply({ success: false, error: 'Unknown action' }, 400);
  }

  const order = validateOrder(body);
  if (!order) {
    return reply({ success: false, error: 'Please check your details and try again.' }, 400);
  }

  if (!env.FORM_SUBMISSIONS) {
    return reply({ success: false, error: 'Order storage is unavailable. Please try again later.' }, 503);
  }

  try {
    const id = 'order-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const record = {
      ...order,
      id,
      submittedAt: new Date().toISOString(),
      status: 'new'
    };
    await env.FORM_SUBMISSIONS.put(ORDER_PREFIX + id, JSON.stringify(record));

    // Send email notification (non-blocking — order is saved regardless)
    await sendNotification(env, order);

    return reply({ success: true, id });
  } catch {
    return reply({ success: false, error: 'Unable to save your order. Please try again.' }, 500);
  }
}
