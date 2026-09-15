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

  var footerAudio = '';
  if (footerAudioUrl) {
    footerAudio = '<div class="audio-footer"><span class="audio-footer-label">&#127925;</span><audio controls preload="metadata"><source src="' + escapeHtml(footerAudioUrl) + '" type="audio/mpeg"></audio></div>';
  }

  var bgImage = 'https://pub-07ed0b0955a4401f9956c3ca7a33c40e.r2.dev/santa%20scroll%202.jpg';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Christmas Letter - ' + escapeHtml(id) + ' - V I Key</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Mountains+of+Christmas:wght@700&family=Caveat:wght@400;600&display=swap" rel="stylesheet"><style>' +
    ':root{--gold:#d4af37;--text-color:#3b2f1e;--text-muted:#6b5a3e;--title-red:#b22222;--title-green:#1f6b2a}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Georgia,"Times New Roman",serif;background-color:#E40A2D;color:var(--text-color);line-height:1.8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}' +
    'body.has-audio-footer{padding-bottom:56px}' +
    '.scroll-wrapper{position:relative;max-width:1000px;width:100%;margin:0 auto}' +
    '.scroll-bg{display:block;width:100%;height:auto;border-radius:8px}' +
    '.letter-card{position:absolute;top:50%;left:50%;transform:translate(-50%,-46%);width:min(42%,420px);padding:0 16px;text-align:center;text-shadow:0 1px 2px rgba(255,255,255,0.5)}' +
    '.letter-title{font-family:"Mountains of Christmas","Great Vibes",cursive;font-size:clamp(1.6rem,4.2vw,3rem);line-height:1.1;margin:0 0 14px;letter-spacing:1px;text-transform:uppercase;color:var(--title-red)}' +
    '.letter-text{font-family:"Caveat",cursive;color:var(--text-color);font-size:clamp(1rem,2.2vw,1.5rem);margin-bottom:30px;white-space:pre-wrap;text-align:left;line-height:1.5}' +
    '.audio-section{margin-top:24px;padding-top:24px;border-top:1px solid rgba(107,90,62,0.3)}' +
    '.audio-label{color:#5c3a1e;font-size:0.9rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}' +
    'audio{width:100%;margin-top:8px}' +
    '.footer{margin-top:30px;color:var(--text-muted);font-size:0.8rem}' +
    '.footer a{color:#5c3a1e;text-decoration:none}' +
    '.empty{color:var(--text-muted);font-size:1rem;padding:40px 0}' +
    '.empty-icon{font-size:3rem;margin-bottom:16px}' +
    '.audio-footer{position:fixed;bottom:0;left:0;right:0;background:rgba(20,20,20,0.93);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid rgba(212,175,55,0.35);padding:7px 14px;z-index:1000;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 -2px 12px rgba(0,0,0,0.3)}' +
    '.audio-footer .audio-footer-label{color:#d4af37;font-size:0.85rem;white-space:nowrap}' +
    '.audio-footer audio{height:30px;max-width:380px;flex:1}' +
    '@media(max-width:768px){.letter-card{top:36%;left:46%;width:min(46%,380px)}.letter-title{font-size:clamp(1.3rem,5.8vw,2.2rem)}}' +
    '@media(max-width:480px){.letter-card{width:min(52%,320px);padding:0 8px;transform:translate(-50%,-7%)}.letter-card h1{font-size:1.2rem;margin-bottom:16px}.letter-icon{font-size:2rem;margin-bottom:12px}.audio-label{font-size:0.75rem}.letter-text{font-size:0.78rem;line-height:1.18}.audio-footer{padding:5px 8px}.audio-footer .audio-footer-label{font-size:0.7rem}.audio-footer audio{height:26px;max-width:100%}}' +
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
      '<script>(function(){const mq=window.matchMedia("(max-width: 900px) and (orientation: landscape)");const elvesWrap=document.getElementById("elves");let built=false;function buildStaticElves(){if(!elvesWrap||built)return;built=true;const icons=["🧝","🧝‍♀️","🎄","🎁","✨"];const spots=[[8,12],[22,28],[38,10],[56,24],[74,14],[88,30],[14,52],[30,46],[48,58],[66,50],[84,62],[10,80],[26,74],[44,86],[62,78],[80,88]];for(let i=0;i<spots.length;i++){const e=document.createElement("span");e.className="elf";e.textContent=icons[i%icons.length];e.style.left=spots[i][0]+"%";e.style.top=spots[i][1]+"%";elvesWrap.appendChild(e)}}function apply(){document.body.classList.toggle("mobile-landscape",mq.matches);if(mq.matches)buildStaticElves()}buildStaticElves();apply();if(mq.addEventListener)mq.addEventListener("change",apply);else mq.addListener(apply)})();</script>' +
      footerAudio +
    '</body></html>';
}

function gateHTML(title, error) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password - V I Key</title><style>*