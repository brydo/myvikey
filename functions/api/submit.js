// Form handler — stores submissions in KV + sends email notification
// Email notifications via FormSubmit.co (free, no signup needed)

export async function onRequestPost({ request, env }) {
  try {
    const formData = await request.formData();
    const data = {};
    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }

    // Add timestamp
    const timestamp = new Date().toISOString();
    data._timestamp = timestamp;

    // Store in KV
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await env.FORM_SUBMISSIONS.put(submissionId, JSON.stringify(data));

    // Send email notification to vikeyshop@outlook.com via FormSubmit.co
    // First submission will trigger a confirmation email — click the link to activate
    try {
      const emailData = new FormData();
      emailData.append('_subject', 'New Christmas Order Submission!');
      emailData.append('Submission_ID', submissionId);
      emailData.append('Timestamp', timestamp);

      // Add all form fields to the email
      for (const [key, value] of formData.entries()) {
        emailData.append(key, value);
      }

      // FormSubmit.co — no API key needed, just the email address
      await fetch('https://formsubmit.co/vikeyshop@outlook.com', {
        method: 'POST',
        body: emailData
      });
    } catch (emailErr) {
      // Email send failed, but submission is still stored in KV
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
