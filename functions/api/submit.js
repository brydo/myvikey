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

    // Build email body for you (the shop)
    let shopEmailBody = '<h2>New Christmas Order Submission</h2>';
    shopEmailBody += `<p><strong>Submission ID:</strong> ${submissionId}</p>`;
    shopEmailBody += `<p><strong>Timestamp:</strong> ${timestamp}</p>`;
    shopEmailBody += '<hr>';
    for (const [key, value] of formData.entries()) {
      if (key === '_gotcha') continue;
      shopEmailBody += `<p><strong>${key}:</strong> ${value}</p>`;
    }

    // Send order email to you
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'noreply@vi-key.uk',
          to: 'vikeyshop@outlook.com',
          subject: 'New Christmas Order Submission!',
          html: shopEmailBody
        })
      });
    } catch (emailErr) {
      console.error('Shop email failed:', emailErr.message);
    }

    // Send acknowledgement email to the customer
    const customerEmail = data.email;
    if (customerEmail) {
      const customerEmailBody = `
        <h2>Thank you for your order! 🎄</h2>
        <p>Hi ${data.parent_name || 'there'},</p>
        <p>We've received your Christmas order and it will be processed in 2 to 3 working days.</p>
        <p><strong>Order details:</strong></p>
        <ul>
          <li><strong>Child's name:</strong> ${data.child_name || 'N/A'}</li>
          <li><strong>Tag choice:</strong> ${data.tag_choice || 'N/A'}</li>
        </ul>
        <p>Best wishes,<br>The VI-Key Team 🎅</p>
        <p>Visit us at <a href="https://vi-key.uk">vi-key.uk</a></p>
      `;
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'noreply@vi-key.uk',
            to: customerEmail,
            subject: 'Order Received — VI-Key Christmas 🎄',
            html: customerEmailBody
          })
        });
      } catch (emailErr) {
        console.error('Customer email failed:', emailErr.message);
      }
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
