async function hash(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function letterHTML(id, content) {
  var body = '';
  if (content && content.text) {
    body += '<h1>A Personal Christmas Note Just For You</h1><div class="letter-text">' + escapeHtml(content.text) + '</div>';
  }
  if (content && content.audioUrl) {
    body += '<div class="audio-section"><div class="audio-label">&#127925; Listen to your letter</div><audio controls preload="metadata"><source src="' + escapeHtml(content.audioUrl) + '" type="audio/mpeg"></audio></div>';
  }
  if (!content || (!content.text && !content.audioUrl)) {
    body = '<div class="empty">This letter is not ready yet. Please check back soon.</div>';
  }
  var bgImage = 'https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/scroll.png';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Christmas Letter - ${escapeHtml(id)} - V I Key</title><link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Caveat:wght@400;600&display=swap" rel="stylesheet"><style>:root{--gold:#d4af37;--text-color:#3b2f1e;--text-muted:#6b5a3e}*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;max-width:100%;overflow-x:hidden}body{font-family:Georgia,"Times New Roman",serif;background-image:url(${bgImage});background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:fixed;color:var(--text-color);line-height:1.8;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:clamp(1rem,3vw,2rem);text-shadow:0 1px 2px rgba(255,255,255,0.5)}.letter-card{width:min(100%,46rem);max-width:100%;padding:clamp(1.5rem,4vw,3.75rem) clamp(1rem,4vw,3.125rem);text-align:center}.letter-card h1{font-family:"Great Vibes",cursive;color:#5c3a1e;font-size:clamp(1.8rem,4vw,2.5rem);font-weight:400;margin-bottom:clamp(1rem,2.5vw,1.5rem);letter-spacing:1px;line-height:1.15}.letter-text{font-family:"Caveat",cursive;color:var(--text-color);font-size:clamp(1.2rem,3vw,1.55rem);margin-bottom:clamp(1.25rem,3vw,1.875rem);white-space:pre-wrap;text-align:left;overflow-wrap:anywhere}.audio-section{margin-top:clamp(1rem,3vw,1.5rem);padding-top:clamp(1rem,3vw,1.5rem);border-top:1px solid rgba(107,90,62,0.3)}.audio-label{color:#5c3a1e;font-size:clamp(0.78rem,1.8vw,0.9rem);text-transform:uppercase;letter-spacing:1px;margin-bottom:0.75rem}.audio-section audio{display:block;width:100%;max-width:100%;margin-top:0.5rem}.footer{margin-top:1.875rem;color:var(--text-muted);font-size:0.8rem}.footer a{color:#5c3a1e;text-decoration:none}.empty{color:var(--text-muted);font-size:clamp(0.95rem,2.4vw,1.05rem);padding:clamp(1.5rem,5vw,2.5rem) 0}@media(max-width:768px){body{background-size:contain;background-position:center center;background-attachment:scroll}.letter-card{width:min(100%,36rem)}}@media(max-width:480px){body{padding:0.875rem}.letter-card{padding:clamp(1.125rem,5vw,1.5rem) clamp(0.875rem,4vw,1rem)}.letter-card h1{margin-bottom:0.875rem}.audio-label{letter-spacing:0.08em}}@media(max-width:900px) and (orientation:landscape){body{background-size:contain;background-position:center center;background-attachment:scroll;padding:0.875rem 1rem}.letter-card{width:min(100%,42rem);padding:clamp(1rem,3vw,1.5rem) clamp(1rem,3vw,1.5rem)}.letter-card h1{font-size:clamp(1.5rem,3vw,2rem)}.letter-text{font-size:clamp(1.05rem,2.5vw,1.25rem)}}</style></head><body><div class="letter-card">${body}</div></body></html>`;
}

function gateHTML(title, error) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password - V I Key</title><style>*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;max-width:100%;overflow-x:hidden}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background-color:#121212;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:clamp(1rem,4vw,1.5rem);line-height:1.6}.gate-card{background-color:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:clamp(1.5rem,4vw,2.5rem) clamp(1rem,4vw,2rem);width:min(100%,24rem);text-align:center;box-shadow:0 16px 40px rgba(0,0,0,0.28)}.gate-icon{font-size:clamp(2rem,5vw,2.5rem);margin-bottom:1rem}.gate-card h1{color:#d4af37;font-size:clamp(1.15rem,3vw,1.35rem);font-weight:500;margin-bottom:0.5rem;letter-spacing:1px}.gate-card p{color:#aaa;font-size:clamp(0.92rem,2.4vw,0.95rem);margin-bottom:1.5rem}.gate-card input{width:100%;max-width:100%;padding:0.875rem 1rem;font-size:1rem;background-color:#121212;color:#e0e0e0;border:1px solid #333;border-radius:8px;margin-bottom:1rem;outline:none;transition:border-color 0.3s}.gate-card input:focus{border-color:#d4af37}.gate-card button{width:100%;padding:0.875rem;font-size:1rem;font-weight:600;color:#d4af37;background-color:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);border-radius:8px;cursor:pointer;transition:background-color 0.3s,box-shadow 0.3s}.gate-card button:hover{background-color:rgba(212,175,55,0.2);box-shadow:0 0 20px rgba(212,175,55,0.15)}.gate-error{color:#ff6b6b;font-size:0.9rem;margin-bottom:1rem}@media(max-width:480px){body{padding:0.875rem}.gate-card{border-radius:10px}.gate-card h1{letter-spacing:0.04em}}</style></head><body><div class="gate-card"><div class="gate-icon">&#128274;</div><h1>${escapeHtml(title)}</h1><p>Please enter the password to continue.</p>${error ? '<div class="gate-error">Incorrect password. Please try again.</div>' : ''}<form method="POST" action=""><input type="password" name="password" placeholder="Password" autofocus required><button type="submit">Unlock Page</button></form></div></body></html>`;
}

export async function onRequest(context) {
  var request = context.request;
  var env = context.env;
  var next = context.next;
  try {
    var url = new URL(request.url);

    // Skip API requests
    if (url.pathname.startsWith('/xmasletters/api/')) return next();

    // Protect admin page
    if (url.pathname === '/xmasletters/admin' || url.pathname === '/xmasletters/admin.html') {
      var adminPassword = await env.PAGE_PASSWORDS.get('__admin__');
      if (!adminPassword) return next();
      var expectedAdminHash = await hash('__admin__:' + adminPassword);
      var cookies = request.headers.get('Cookie') || '';
      var adminCookieMatch = cookies.split(';').some(function(c) { return c.trim() === 'auth___admin__=' + expectedAdminHash; });
      if (request.method === 'POST') {
        var formData = await request.formData();
        var submittedPassword = formData.get('password');
        if (submittedPassword === adminPassword) {
          return new Response(null, { status: 302, headers: { 'Location': url.pathname, 'Set-Cookie': 'auth___admin__=' + expectedAdminHash + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400' } });
        } else {
          return new Response(gateHTML('Admin Access', true), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      }
      if (adminCookieMatch) return next();
      return new Response(gateHTML('Admin Access', false), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Handle letter pages with ?id=
    var pageId = url.searchParams.get('id');
    if (!pageId) return next();

    // Read content from KV
    var content = null;
    var rawContent = await env.XMAS_CONTENT.get(pageId);
    if (rawContent) {
      try { content = JSON.parse(rawContent); } catch (e) { content = null; }
    }

    // Check if password protected
    var storedPassword = await env.PAGE_PASSWORDS.get(pageId);

    if (!storedPassword) {
      return new Response(letterHTML(pageId, content), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    var expectedCookieValue = await hash(pageId + ':' + storedPassword);
    var cookieName = 'auth_' + pageId;

    if (request.method === 'POST') {
      var formData = await request.formData();
      var submittedPassword = formData.get('password');
      if (submittedPassword === storedPassword) {
        var redirectUrl = url.pathname + url.search;
        return new Response(null, { status: 302, headers: { 'Location': redirectUrl, 'Set-Cookie': cookieName + '=' + expectedCookieValue + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400' } });
      } else {
        return new Response(gateHTML('This Page is Protected', true), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    }

    var cookies = request.headers.get('Cookie') || '';
    var cookieMatch = cookies.split(';').some(function(c) { return c.trim() === cookieName + '=' + expectedCookieValue; });

    if (cookieMatch) {
      return new Response(letterHTML(pageId, content), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return new Response(gateHTML('This Page is Protected', false), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (e) {
    return next();
  }
}
