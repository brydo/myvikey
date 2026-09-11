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
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function letterHTML(id, content) {
  var raw = (content && content.text) ? String(content.text) : '';
  var lines = raw.split(/\r?\n/);
  var heading = '';
  var rest = '';

  if (lines.length > 0 && lines[0].trim()) {
    heading = lines[0].trim();
    rest = lines.slice(1).join('\n').trim();
  } else {
    rest = raw;
  }

  var body = '';
  if (raw) {
    body += '<h1 class="letter-title">' + escapeHtml(heading || 'Christmas Wish Message') + '</h1>';
    body += '<div class="letter-text">' + escapeHtml(rest) + '</div>';
  }

  if (content && content.audioUrl) {
    body += '<div class="audio-section"><div class="audio-label">&#127925; Listen to your letter</div><audio controls preload="metadata"><source src="' + escapeHtml(content.audioUrl) + '" type="audio/mpeg">Your browser does not support the audio element.</audio></div>';
  }

  if (!content || (!content.text && !content.audioUrl)) {
    body = '<div class="empty">This letter is not ready yet. Please check back soon.</div>';
  }

  var bgImage = 'https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/santa%20scroll%202.jpg';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Christmas Letter - ' + escapeHtml(id) + ' - V I Key</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Great+Vibes&family=Mountains+of+Christmas:wght@700&display=swap" rel="stylesheet"><style>' +
    ':root{--gold:#d4af37;--text-color:#3b2f1e;--text-muted:#6b5a3e;--title-red:#b22222;--title-green:#1f6b2a}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Georgia,"Times New Roman",serif;background-color:#2a1a0e;color:var(--text-color);line-height:1.8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.scroll-wrapper{position:relative;max-width:1000px;width:100%;margin:0 auto}' +
    '.scroll-bg{display:block;width:100%;height:auto;border-radius:8px}' +
    '.letter-card{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(42%,420px);padding:0 16px;text-align:center;text-shadow:0 1px 2px rgba(255,255,255,0.5)}' +
    /* BIG MERRY TOP LINE */
   '.letter-title{font-family:"Mountains of Christmas","Great Vibes",cursive;font-size:clamp(1.6rem,4.2vw,3rem);line-height:1.1;margin:0 0 14px;letter-spacing:1px;text-transform:uppercase;color:var(--title-red);text-shadow:0 2px 0 #fff,0 0 10px rgba(212,175,55,.45)}' +

    '.letter-text{font-family:"Caveat",cursive;color:var(--text-color);font-size:clamp(1rem,2.2vw,1.5rem);margin-bottom:30px;white-space:pre-wrap;text-align:left;line-height:1.5}' +
    '.audio-section{margin-top:24px;padding-top:24px;border-top:1px solid rgba(107,90,62,0.3)}' +
    '.audio-label{color:#5c3a1e;font-size:0.9rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}' +
    'audio{width:100%;margin-top:8px}' +
    '.footer{margin-top:30px;color:var(--text-muted);font-size:0.8rem}' +
    '.footer a{color:#5c3a1e;text-decoration:none}' +
    '.empty{color:var(--text-muted);font-size:1rem;padding:40px 0}' +
    '.empty-icon{font-size:3rem;margin-bottom:16px}' +
    '@media(max-width:768px){.letter-card{top:36%;left:46%;width:min(46%,380px)}.letter-title{font-size:clamp(1.3rem,5.8vw,2.2rem)}}' +
   '@media(max-width:480px){.letter-card{width:min(52%,320px);padding:0 8px;transform:translate(-50%,-7%)}.letter-card h1{font-size:1.2rem;margin-bottom:16px}.letter-icon{font-size:2rem;margin-bottom:12px}.audio-label{font-size:0.75rem}.letter-text{font-size:0.78rem;line-height:1.18}}' +
    '</style></head>' +
    '<body><div class="scroll-wrapper"><img class="scroll-bg" src="' + bgImage + '" alt="Christmas scroll"><div class="letter-card">' + body + '</div></div></body></html>';
}

function gateHTML(title, error) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password - V I Key</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:#111;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:16px}.card{background:#1b1b1b;border:1px solid #333;border-radius:10px;padding:24px;max-width:360px;width:100%}h1{font-size:1.2rem;margin:0 0 12px}p{color:#bbb;margin:0 0 14px}input{width:100%;padding:12px;border-radius:8px;border:1px solid #444;background:#101010;color:#fff}button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:8px;background:#2e7d32;color:white;font-weight:700;cursor:pointer}.error{color:#ff8a80;margin-top:10px}</style></head><body><form class="card" method="POST"><h1>' + escapeHtml(title) + '</h1><p>Please enter the password to continue.</p><input type="password" name="password" placeholder="Password" required><button type="submit">Unlock</button>' + (error ? '<div class="error">Incorrect password. Please try again.</div>' : '') + '</form></body></html>';
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
          return new Response(null, {
            status: 302,
            headers: {
              'Location': url.pathname,
              'Set-Cookie': 'auth___admin__=' + expectedAdminHash + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400'
            }
          });
        } else {
          return new Response(gateHTML('Admin Access', true), {
            status: 401,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
      }

      if (adminCookieMatch) return next();
      return new Response(gateHTML('Admin Access', false), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
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
      return new Response(letterHTML(pageId, content), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    var expectedCookieValue = await hash(pageId + ':' + storedPassword);
    var cookieName = 'auth_' + pageId;

    if (request.method === 'POST') {
      var formData = await request.formData();
      var submittedPassword = formData.get('password');
      if (submittedPassword === storedPassword) {
        var redirectUrl = url.pathname + url.search;
        return new Response(null, {
          status: 302,
          headers: {
            'Location': redirectUrl,
            'Set-Cookie': cookieName + '=' + expectedCookieValue + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400'
          }
        });
      } else {
        return new Response(gateHTML('This Page is Protected', true), {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }

    var cookies = request.headers.get('Cookie') || '';
    var cookieMatch = cookies.split(';').some(function(c) {
      return c.trim() === cookieName + '=' + expectedCookieValue;
    });

    if (cookieMatch) {
      return new Response(letterHTML(pageId, content), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response(gateHTML('This Page is Protected', false), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (e) {
    return next();
  }
}
