// Form submission handler — replaces Formspree
// Stores submissions in KV (FORM_SUBMISSIONS binding)

export async function onRequestPost({ request, env }) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let data;
    if (contentType.includes('application/json')) {
      data = await request.json();
    } else if (contentType.includes('form-data') || contentType.includes('urlencoded')) {
      const formData = await request.formData();
      data = {};
      for (const [key, value] of formData.entries()) {
        if (key === 'tag_choice') {
          if (!data[key]) data[key] = [];
          data[key].push(value);
        } else {
          data[key] = value;
        }
      }
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported content type' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Honeypot check — if _gotcha field is filled, it's a bot
    if (data._gotcha) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Remove Formspree-specific fields
    delete data._next;
    delete data._subject;
    delete data._captcha;
    delete data._gotcha;

    // Build submission record
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = new Date().toISOString();
    const submission = {
      id: submissionId,
      timestamp,
      ...data
    };

    // Store in KV
    await env.FORM_SUBMISSIONS.put(submissionId, JSON.stringify(submission));

    // Also store an index entry for listing
    const indexKey = 'index_submissions';
    let index = [];
    try {
      const existing = await env.FORM_SUBMISSIONS.get(indexKey);
      if (existing) index = JSON.parse(existing);
    } catch (e) {
      index = [];
    }
    index.unshift({ id: submissionId, timestamp, parent_name: data.parent_name, email: data.email, child_name: data.child_name });
    if (index.length > 500) index = index.slice(0, 500);
    await env.FORM_SUBMISSIONS.put(indexKey, JSON.stringify(index));

    // Try to send email notification (optional — uses Resend)
    if (env.FORM_EMAIL_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.FORM_EMAIL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'orders@myvikey.pages.dev',
            to: 'vikeyshop@outlook.com',
            subject: `New Santa VI-Key Order — ${data.parent_name || 'Unknown'}`,
            html: buildEmailHtml(submission)
          })
        });
      } catch (emailErr) {
        console.log('Email notification failed:', emailErr.message);
      }
    }

    return new Response(JSON.stringify({ success: true, id: submissionId }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    console.error('Submit error:', err);
    return new Response(JSON.stringify({ error: 'Failed to process submission' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function buildEmailHtml(sub) {
  const rows = Object.entries(sub)
    .filter(([k]) => k !== 'id')
    .map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:700;vertical-align:top;">${k}</td><td style="padding:6px 12px;">${Array.isArray(v) ? v.join(', ') : v}</td></tr>`)
    .join('');
  return `
    <h2>🎅 New Santa VI-Key Order</h2>
    <p><strong>Received:</strong> ${sub.timestamp}</p>
    <table style="border-collapse:collapse;border:1px solid #e2e8f0;">${rows}</table>
  `;
}
