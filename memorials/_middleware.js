

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

function memorialHTML(id, content) {
  var name = (content && content.name) ? String(content.name).trim() : '';
  var photoUrl = (content && content.photoUrl) ? String(content.photoUrl).trim() : '';
  var text = (content && content.text) ? String(content.text) : '';
  var audioUrl = (content && content.audioUrl) ? String(content.audioUrl).trim() : '';

  var body = '';

  body += '<h1 class="memorial-title">In Loving Memory</h1>';
  body += '<div class="memorial-name">of ' + escapeHtml(name || 'Someone Special') + '</div>';

  if (photoUrl) {
    body += '<img class="memorial-photo" src="' + escapeHtml(photoUrl) + '" alt="In Loving Memory">';
  }

  if (text) {
    body += '<div class="memorial-text">' + escapeHtml(text) + '</div>';
  }

  if (audioUrl) {
    body += '<div class="audio-section"><audio controls controlslist="nodownload" preload="metadata"><source src="' + escapeHtml(audioUrl) + '" type="audio/mpeg"></audio></div>';
  }

  if (!photoUrl && !text && !audioUrl) {
    body = '<div class="empty">This memorial is not ready yet. Please check back soon.</div>';
  }

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>In Loving Memory - ' + escapeHtml(name || id) + ' - V I Key</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Mountains+of+Christmas:wght@400;700&family=Caveat:wght@400;600&display=swap" rel="stylesheet"><style>' +
    ':root{--gold:#c9a96e;--gold-glow:rgba(201,169,110,0.15);--text-color:#e8e6e3;--text-muted:#a8a4a0;--card-border:rgba(255,255,255,0.08);--bg-base:#12110F;--bg-gradient:radial-gradient(circle at top,#1c1a16 0%,#12110F 70%)}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Georgia,"Times New Roman",serif;background:var(--bg-gradient);background-color:var(--bg-base);color:var(--text-color);line-height:1.8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;overflow-x:hidden}' +
    '.memorial-card{max-width:500px;width:100%;text-align:center}' +
    '.memorial-title{font-family:"Mountains of Christmas",cursive;font-size:clamp(1.8rem,5vw,2.8rem);color:var(--gold);margin-bottom:4px;font-weight:700;line-height:1.2}' +
    '.memorial-name{font-family:"Mountains of Christmas",cursive;font-size:clamp(1.3rem,4vw,1.8rem);color:var(--text-muted);margin-bottom:30px;font-weight:400}' +
    '.memorial-photo{width:100%;max-width:360px;border-radius:12px;box-shadow:0 0 25px var(--gold-glow);border:1px solid var(--card-border);margin:0 auto 30px;display:block}' +
    '.memorial-text{font-family:"Caveat",cursive;color:var(--text-color);font-size:clamp(1.1rem,3vw,1.4rem);margin-bottom:25px;white-space:pre-wrap;line-height:1.5;padding:0 20px}' +
    '.audio-section{margin-top:10px;margin-bottom:10px}' +
    '.audio-section audio{width:100%;max-width:280px;height:32px;margin:0 auto;display:block}' +
    'audio::-internal-media-controls-download-button{display:none}audio::-webkit-media-controls-enclosure{overflow:hidden}audio::-webkit-media-controls-panel{width:calc(100% + 30px)}' +
    '.divider{margin:30px auto 20px;width:120px;height:2px;background:linear-gradient(to right,transparent,var(--gold),transparent);border-radius:2px;opacity:0.5}' +
    '.tribute-line{font-size:0.95rem;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:20px;font-family:Georgia,"Times New Roman",serif}' +
    '.back-link{display:inline-block;color:var(--text-muted);font-size:0.85rem;text-decoration:none;transition:0.25s ease}' +
    '.back-link:hover{color:var(--gold)}' +
    '.empty{color:var(--text-muted);font-size:1rem;padding:40px 0}' +
    '.landscape-note{display:none;position:fixed;inset:0;z-index:9999;background:url(https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/cosy.jpg) center/cover no-repeat;color:#f5e6c8;text-align:center;padding:24px;font-family:Georgia,"Times New Roman",serif;overflow:hidden;flex-direction:column;align-items:center;justify-content:center;gap:16px}' +
    '.landscape-text{position:relative;z-index:2;font-size:1.2rem;max-width:90vw;line-height:1.4;background:rgba(0,0,0,0.55);padding:16px 24px;border-radius:8px}' +
    'body.mobile-landscape .memorial-card{display:none!important}' +
    'body.mobile-landscape .landscape-note{display:flex!important}' +
    '@media(max-width:768px){.memorial-photo{max-width:320px}}' +
    '@media(max-width:480px){.memorial-photo{max-width:260px}.memorial-title{font-size:1.5rem}.memorial-name{font-size:1.1rem;margin-bottom:20px}.memorial-text{font-size:1rem;padding:0 10px}.audio-section audio{max-width:220px;height:28px}}' +
    '</style></head>' +
    '<body>' +
      '<div class="landscape-note"><div class="landscape-text">Please rotate your phone or your device to portrait.</div></div>' +
      '<div class="memorial-card">' + body +
        '<div class="divider"></div>' +
        '<div class="tribute-line">Forever in our hearts</div>' +
        '<a class="back-link" href="/">&larr; Back to home</a>' +
      '</div>' +
      '<script>(function(){const mq=window.matchMedia("(max-width: 900px) and (orientation: landscape)");function apply(){document.body.classList.toggle("mobile-landscape",mq.matches)}apply();if(mq.addEventListener)mq.addEventListener("change",apply);else mq.addListener(apply)})();</script>' +
    '</body></html>';
}

function gateHTML(title, error) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password - V I Key</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#12110F;color:#e8e6e3;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;line-height:1.6}.gate-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:40px 32px;max-width:380px;width:100%;text-align:center}.gate-card h1{color:#c9a96e;font-size:1.3rem;font-weight:500;margin-bottom:8px;letter-spacing:1px}.gate-card p{color:#a8a4a0;font-size:0.95rem;margin-bottom:24px}.gate-card input{width:100%;padding:14px 16px;font-size:1rem;background-color:#12110F;color:#e8e6e3;border:1px solid rgba(255,255,255,0.12);border-radius:8px;margin-bottom:16px;outline:none;transition:border-color 0.3s}.gate-card input:focus{border-color:#c9a96e}.gate-card button{width:100%;padding:14px;font-size:1rem;font-weight:600;color:#c9a96e;background-color:rgba(201,169,110,0.1);border:1px solid rgba(201,169,110,0.3);border-radius:8px;cursor:pointer;transition:background-color 0.3s}.gate-card button:hover{background-color:rgba(201,169,110,0.2)}.gate-error{color:#ff6b6b;font-size:0.9rem;margin-bottom:16px}</style></head><body><div class="gate-card"><h1>' + escapeHtml(title) + '</h1><p>Please enter the password to continue.</p>' + (error ? '<div class="gate-error">Incorrect password. Please try again.</div>' : '') + '<form method="POST"><input type="password" name="password" placeholder="Password" autofocus required><button type="submit">Unlock Page</button></form></div></body></html>';
}

export async function onRequest(context) {
  var request = context.request;
  var env = context.env;
  var next = context.next;
  try {
    var url = new URL(request.url);

    // Skip API requests
    if (url.pathname.startsWith('/memorials/api/')) return next();

    // Protect admin page
    if (url.pathname === '/memorials/admin' || url.pathname === '/memorials/admin.html') {
      var adminPassword = await env.MEMORIAL_PASSWORDS.get('__admin__');
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

    // Handle memorial pages with ?id=
    var pageId = url.searchParams.get('id');
    if (!pageId) return next();

    // Read content from KV
    var content = null;
    var rawContent = await env.MEMORIAL_CONTENT.get(pageId);
    if (rawContent) {
      try { content = JSON.parse(rawContent); } catch (e) { content = null; }
    }

    // Check if password protected
    var storedPassword = await env.MEMORIAL_PASSWORDS.get(pageId);

    if (!storedPassword) {
      return new Response(memorialHTML(pageId, content), {
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
        return new Response(gateHTML('This Memorial is Protected', true), {
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
      return new Response(memorialHTML(pageId, content), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response(gateHTML('This Memorial is Protected', false), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (e) {
    return next();
  }
}