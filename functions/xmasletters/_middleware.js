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

function letterHTML(id, content, footerAudioUrl) {
  var greeting = (content && content.greeting) ? String(content.greeting).trim() : '';
  var raw = (content && content.text) ? String(content.text) : '';

  var body = '';
  if (greeting || raw) {
    body += '<h1 class="letter-title">' + escapeHtml(greeting || 'Christmas Wish Message') + '</h1>';
    body += '<div class="letter-text">' + escapeHtml(raw) + '</div>';
  }

  if (content && content.audioUrl) {
    body += '<div class="audio-section"><div class="audio-label">&#127925; Listen to your letter</div><audio controls controlslist="nodownload" preload="metadata"><source src="' + escapeHtml(content.audioUrl) + '" type="audio/mpeg">Your browser does not support the audio element.</audio></div>';
  }

  if (!content || (!content.text && !content.audioUrl)) {
    body = '<div class="empty">This letter is not ready yet. Please check back soon.</div>';
  }

  var footerAudio = '';
  if (footerAudioUrl) {
    footerAudio = '<div class="audio-footer"><span class="audio-footer-label">&#127925;</span><audio controls controlslist="nodownload" preload="metadata"><source src="' + escapeHtml(footerAudioUrl) + '" type="audio/mpeg"></audio></div>';
  }

  var bgImage = 'https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/santa%20scroll%202.jpg';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Christmas Letter - ' + escapeHtml(id) + ' - V I Key</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Mountains+of+Christmas:wght@700&family=Caveat:wght@400;600&display=swap" rel="stylesheet"><style>' +
    ':root{--gold:#d4af37;--text-color:#3b2f1e;--text-muted:#6b5a3e;--title-red:#b22222;--title-green:#1f6b2a}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Georgia,"Times New Roman",serif;background-color:#C41E3A;color:var(--text-color);line-height:1.8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}' +
    'body.has-audio-footer{padding-bottom:56px}' +
    '.scroll-wrapper{position:relative;max-width:1000px;width:100%;margin:0 auto}' +
    '.scroll-bg{display:block;width:100%;height:auto;border-radius:8px}' +
    '.letter-card{position:absolute;top:50%;left:50%;transform:translate(-50%,-46%);width:min(42%,420px);padding:0 16px;text-align:center;text-shadow:0 1px 2px rgba(255,255,255,0.5)}' +
    '.letter-title{font-family:"Mountains of Christmas","Great Vibes",cursive;font-size:clamp(1.6rem,4.2vw,3rem);line-height:1.1;margin:0 0 14px;letter-spacing:1px;color:var(--text-color)}' +
    '.letter-text{font-family:"Caveat",cursive;color:var(--text-color);font-size:clamp(1rem,2.2vw,1.5rem);margin-bottom:30px;white-space:pre-wrap;text-align:left;line-height:1.5}' +
    '.audio-section{margin-top:24px;padding-top:24px;border-top:1px solid rgba(107,90,62,0.3)}' +
    '.audio-label{color:#5c3a1e;font-size:0.9rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}' +
    'audio{width:100%;margin-top:8px}audio::-internal-media-controls-download-button{display:none}audio::-webkit-media-controls-enclosure{overflow:hidden}audio::-webkit-media-controls-panel{width:calc(100% + 30px)}' +
    '.footer{margin-top:30px;color:var(--text-muted);font-size:0.8rem}' +
    '.footer a{color:#5c3a1e;text-decoration:none}' +
    '.empty{color:var(--text-muted);font-size:1rem;padding:40px 0}' +
    '.empty-icon{font-size:3rem;margin-bottom:16px}' +
    '.audio-footer{position:fixed;bottom:0;left:0;right:0;background:rgba(20,20,20,0.93);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid rgba(212,175,55,0.35);padding:7px 14px;z-index:1000;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 -2px 12px rgba(0,0,0,0.3)}' +
    '.audio-footer .audio-footer-label{color:#d4af37;font-size:0.85rem;white-space:nowrap}' +
    '.audio-footer audio{height:30px;max-width:380px;flex:1}' +
    '@media(max-width:768px){.letter-card{top:36%;left:46%;width:min(46%,380px)}.letter-title{font-size:clamp(1.3rem,5.8vw,2.2rem)}}' +
    '@media(max-width:480px){.letter-card{width:min(52%,320px);padding:0 8px;top:38%;transform:translate(-50%,0)}.letter-card h1{font-size:1.2rem;margin-bottom:16px}.letter-icon{font-size:2rem;margin-bottom:12px}.audio-label{font-size:0.75rem}.letter-text{font-size:0.78rem;line-height:1.18;max-height:42vh;overflow-y:auto}.audio-footer{padding:5px 8px}.audio-footer .audio-footer-label{font-size:0.7rem}.audio-footer audio{height:26px;max-width:100%}}' +
    '.landscape-note{display:none;position:fixed;inset:0;z-index:9999;background:url(https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/cosy.jpg) center/cover no-repeat;color:#f5e6c8;text-align:center;padding:24px;font-family:Georgia,"Times New Roman",serif;overflow:hidden;flex-direction:column;align-items:center;justify-content:center;gap:16px}' +
    '.landscape-text{position:relative;z-index:2;font-size:1.2rem;max-width:90vw;line-height:1.4;background:rgba(0,0,0,0.55);padding:16px 24px;border-radius:8px}' +
    'body.mobile-landscape .scroll-wrapper{display:none!important}' +
    'body.mobile-landscape .landscape-note{display:flex!important}' +
    '</style></head>' +
    '<body' + (footerAudioUrl ? ' class="has-audio-footer"' : '') + '>' +
      '<div class="landscape-note">' +
        '<div class="landscape-text">Ho ho ho! You\'re holding it like a Christmas cracker! 🎁 Please rotate your phone or your device to portrait.</div>' +
      '</div>' +
      '<div class="scroll-wrapper"><img class="scroll-bg" src="' + bgImage + '" alt="Christmas scroll"><div class="letter-card">' + body + '</div></div>' +
      '<script>(function(){const mq=window.matchMedia("(max-width: 900px) and (orientation: landscape)");function apply(){document.body.classList.toggle("mobile-landscape",mq.matches)}apply();if(mq.addEventListener)mq.addEventListener("change",apply);else mq.addListener(apply)})();</script>' +
      footerAudio +
    '</body></html>';
}

function gateHTML(title, error) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password - V I Key</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:#C41E3A;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.card{background:#f3e6cf;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);max-width:400px;width:100%}h2{margin-top:0;color:#333}input[type=password]{width:100%;padding:12px;border:1px solid #ddd;border-radius:4px;font-size:16px;margin:10px 0}button{background:#007bff;color:#fff;border:none;padding:12px 24px;border-radius:4px;font-size:16px;cursor:pointer;width:100%}button:hover{background:#0056b3}.error{color:#d32f2f;background:#ffebee;padding:10px;border-radius:4px;margin-bottom:15px}</style></head><body><div class="card"><h2>' + escapeHtml(title) + '</h2>' + (error ? '<div class="error">Incorrect password. Please try again.</div>' : '') + '<form method="POST"><input type="password" name="password" placeholder="Enter password" required autofocus><button type="submit">Access Page</button></form></div></body></html>';
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

    // Check if audio file exists for this person in the site's static assets folder
    var footerAudioUrl = null;
    var safePageId = pageId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (safePageId) {
      try {
        var audioCheckUrl = 'https://audio.vi-key.uk/' + safePageId + '.mp3';
        var audioCheckResp = await fetch(audioCheckUrl, { method: 'HEAD' });
        if (audioCheckResp.ok) {
          var audioContentType = (audioCheckResp.headers.get('content-type') || '').toLowerCase();
          if (audioContentType.indexOf('audio') === 0 || audioContentType.indexOf('application/octet-stream') === 0) {
            footerAudioUrl = audioCheckUrl;
          }
        } else if (audioCheckResp.status === 405 || audioCheckResp.status === 403) {
          // HEAD not supported — try GET with range
          var audioGetResp = await fetch(audioCheckUrl, { headers: { 'Range': 'bytes=0-0' } });
          if (audioGetResp.ok || audioGetResp.status === 206) {
            var audioGetContentType = (audioGetResp.headers.get('content-type') || '').toLowerCase();
            if (audioGetContentType.indexOf('audio') === 0 || audioGetContentType.indexOf('application/octet-stream') === 0) {
              footerAudioUrl = audioCheckUrl;
            }
          }
        }
      } catch (e) {}
    }

    // Check if password protected
    var storedPassword = await env.PAGE_PASSWORDS.get(pageId);

    if (!storedPassword) {
      return new Response(letterHTML(pageId, content, footerAudioUrl), {
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
      return new Response(letterHTML(pageId, content, footerAudioUrl), {
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
