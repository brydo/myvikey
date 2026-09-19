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
  var body = '';
  if (content && content.text) {
    body += '<div class="letter-text">' + escapeHtml(content.text) + '</div>';
  }
  if (!content || !content.text) {
    body = '<div class="empty">This letter is not ready yet. Please check back soon.</div>';
  }

  var footerAudio = '';
  if (footerAudioUrl) {
    footerAudio = '<div class="audio-footer"><span class="audio-footer-label">&#127925;</span><audio controls controlslist="nodownload" preload="metadata"><source src="' + escapeHtml(footerAudioUrl) + '" type="audio/mpeg"></audio></div>';
  }

  var bgImage = 'https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/santa%20scroll%202.jpg';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Christmas Letter - ' + escapeHtml(id) + ' - V I Key</title><link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Caveat:wght@400;600&display=swap" rel="stylesheet"><style>' +
    ':root{--gold:#d4af37;--text-color:#3b2f1e;--text-muted:#6b5a3e}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Georgia,"Times New Roman",serif;background-color:#E40A2D;color:var(--text-color);line-height:1.8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}' +
    'body.has-audio-footer{padding-bottom:56px}' +
    '.scroll-wrapper{position:relative;max-width:1000px;width:100%;margin:0 auto}' +
    '.scroll-bg{display:block;width:100%;height:auto;border-radius:8px}' +
    '.letter-card{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);width:40%;padding:0 16px;text-align:center;text-shadow:0 1px 2px rgba(255,255,255,0.5)}' +
    '.letter-icon{font-size:3rem;margin-bottom:20px}' +
    '.letter-card h1{font-family:"Great Vibes",cursive;color:#5c3a1e;font-size:2.2rem;font-weight:400;margin-bottom:24px;letter-spacing:1px}' +
    '.letter-text{font-family:"Caveat",cursive;color:var(--text-color);font-size:1.1rem;margin-bottom:30px;white-space:pre-wrap;text-align:center}' +
    'audio{width:100%;margin-top:8px}' +
    '.footer{margin-top:30px;color:var(--text-muted);font-size:0.8rem}' +
    '.footer a{color:#5c3a1e;text-decoration:none}' +
    '.empty{color:var(--text-muted);font-size:1rem;padding:40px 0;text-align:center}' +
    '.empty-icon{font-size:3rem;margin-bottom:16px}' +
    '.audio-footer{position:fixed;bottom:0;left:0;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 12px;background-color:rgba(26,26,26,0.92);z-index:9998}' +
    '.audio-footer .audio-footer-label{font-size:0.9rem;flex-shrink:0}' +
    '.audio-footer audio{height:30px;max-width:380px;flex:1}' +
    '@media(max-width:480px){.letter-card{top:25%;left:50%;transform:translateX(-50%);width:48%;padding:0 8px}.letter-card h1{font-size:1rem;margin-bottom:16px}.letter-text{font-size:0.8rem;line-height:1.35}.letter-icon{font-size:2rem;margin-bottom:12px}.audio-section{margin-top:16px;padding-top:16px}.audio-footer{padding:5px 8px}.audio-footer .audio-footer-label{font-size:0.7rem}.audio-footer audio{height:26px;max-width:100%}}' +
    '@media(max-width:768px){.letter-card{top:46%;left:50%;transform:translate(-50%,-50%);width:fit-content;max-width:44%}.letter-card h1{font-size:1.8rem}.letter-text{font-size:1.2rem}}' +
    '.landscape-note{display:none;position:fixed;inset:0;z-index:9999;background:#E40A2D;color:#f5e6c8;text-align:center;padding:24px;font-family:Georgia,"Times New Roman",serif;overflow:hidden;flex-direction:column;align-items:center;justify-content:center;gap:16px}' +
    '.landscape-text{position:relative;z-index:2;font-size:1.2rem;max-width:90vw;line-height:1.4}' +
    '.elves{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}' +
    '.elf{position:absolute;font-size:1.8rem;opacity:.9}' +
    'body.mobile-landscape .scroll-wrapper{display:none!important}' +
    'body.mobile-landscape .landscape-note{display:flex!important}' +
    '</style></head>' +
    '<body' + (footerAudioUrl ? ' class="has-audio-footer"' : '') + '>' +
      '<div class="landscape-note">' +
        '<div class="landscape-text">Please rotate your phone to portrait.</div>' +
        '<div class="elves" id="elves"></div>' +
      '</div>' +
      '<div class="scroll-wrapper"><img class="scroll-bg" src="' + bgImage + '" alt="Christmas scroll"><div class="letter-card">' + body + '</div></div>' +
      '<script>(function(){var mq=window.matchMedia("(max-width: 900px) and (orientation: landscape)");var elvesWrap=document.getElementById("elves");var built=false;function buildStaticElves(){if(!elvesWrap||built)return;built=true;var icons=["🧝","🧝‍♀️","🎄","🎁","✨"];var spots=[[8,12],[22,28],[38,10],[56,24],[74,14],[88,30],[14,52],[30,46],[48,58],[66,50],[84,62],[10,80],[26,74],[44,86],[62,78],[80,88]];for(var i=0;i<spots.length;i++){var e=document.createElement("span");e.className="elf";e.textContent=icons[i%icons.length];e.style.left=spots[i][0]+"%";e.style.top=spots[i][1]+"%";elvesWrap.appendChild(e)}}function apply(){document.body.classList.toggle("mobile-landscape",mq.matches);if(mq.matches)buildStaticElves()}buildStaticElves();apply();if(mq.addEventListener)mq.addEventListener("change",apply);else mq.addListener(apply)})();</script>' +
      '<script>(function(){var card=document.querySelector(".letter-card");var wrapper=document.querySelector(".scroll-wrapper");if(!card||!wrapper)return;var bg=wrapper.querySelector(".scroll-bg");if(!bg)return;function fit(){var maxH=bg.offsetHeight*0.35;var fs=parseFloat(getComputedStyle(card).fontSize);var steps=0;while(card.offsetHeight>maxH&&fs>0.5&&steps<50){fs-=0.5;card.style.fontSize=fs+"px";steps++}}if(bg.complete)fit();else bg.onload=fit;window.addEventListener("resize",fit)})();</script>' +
      footerAudio +
        
    '</body></html>';
}

function gateHTML(title, error) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password - V I Key</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background-color:#E40A2D;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;line-height:1.6}.gate-card{background-color:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:40px 32px;max-width:380px;width:100%;text-align:center}.gate-icon{font-size:2.5rem;margin-bottom:16px}.gate-card h1{color:#d4af37;font-size:1.3rem;font-weight:500;margin-bottom:8px;letter-spacing:1px}.gate-card p{color:#aaa;font-size:0.95rem;margin-bottom:24px}.gate-card input{width:100%;padding:14px 16px;font-size:1rem;background-color:#121212;color:#e0e0e0;border:1px solid #333;border-radius:8px;margin-bottom:16px;outline:none;transition:border-color 0.3s}.gate-card input:focus{border-color:#d4af37}.gate-card button{width:100%;padding:14px;font-size:1rem;font-weight:600;color:#d4af37;background-color:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);border-radius:8px;cursor:pointer;transition:background-color 0.3s,box-shadow 0.3s}.gate-card button:hover{background-color:rgba(212,175,55,0.2);box-shadow:0 0 20px rgba(212,175,55,0.15)}.gate-error{color:#ff6b6b;font-size:0.9rem;margin-bottom:16px}</style></head><body><div class="gate-card"><div class="gate-icon">&#128274;</div><h1>' + escapeHtml(title) + '</h1><p>Please enter the password to continue.</p>' + (error ? '<div class="gate-error">Incorrect password. Please try again.</div>' : '') + '<form method="POST" action=""><input type="password" name="password" placeholder="Password" autofocus required><button type="submit">Unlock Page</button></form></div></body></html>';
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

    // Check if audio file exists for this person in the site's static assets folder
    var footerAudioUrl = null;
    var safePageId = pageId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (safePageId) {
      try {
        var audioCheckUrl = url.origin + '/assets/' + safePageId + '.mp3';
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
      return new Response(letterHTML(pageId, content, footerAudioUrl), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
      return new Response(letterHTML(pageId, content, footerAudioUrl), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return new Response(gateHTML('This Page is Protected', false), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (e) {
    return next();
  }
}
