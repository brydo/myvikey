// Form handler — stores submissions in KV + sends email via Resend
export async function onRequestPost({ request, env }) {
  try {
    const formData = await request.formData();
    const data = {};
    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }

    const timestamp = new Date().toISOString();
    data._timestamp = timestamp;

    // Store in KV
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await env.FORM_SUBMISSIONS.put(submissionId, JSON.stringify(data));

    // Build email body from form data
    let emailBody = '<h2>New Christmas Order Submission</h2>';
    emailBody += `<p><strong>Submission ID:</strong> ${submissionId}</p>`;
    emailBody += `<p><strong>Timestamp:</strong> ${timestamp}</p>`;
    emailBody += '<hr>';
    for (const [key, value] of formData.entries()) {
      if (key === '_gotcha') continue;
      emailBody += `<p><strong>${key}:</strong> ${value}</p>`;
    }

    // Send email via Resend
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: 'vikeyshop@outlook.com',
          subject: 'New Christmas Order Submission!',
          html: emailBody
        })
      });
    } catch (emailErr) {
      console.error('Email notification failed:', emailErr.message);
    }

    return new Response(JSON.stringify({ success: true, id: submissionId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
