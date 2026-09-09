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
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Christmas Letter - ' + escapeHtml(id) + ' - V I Key</title><link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Caveat:wght@400;600&display=swap" rel="stylesheet"><style>:root{--gold:#d4af37;--text-color:#3b2f1e;--text-muted:#6b5a3e}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Georgia,"Times New Roman",serif;background-image:url(' + bgImage + ');background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:fixed;color:var(--text-color);line-height:1.8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.letter-card{background:transparent;border:none;border-radius:0;padding:60px 50px;max-width:520px;width:100%;margin-left:520px;margin-top:-150px;text-align:center;text-shadow:0 1px 2px rgba(255,255,255,0.5)}.letter-icon{font-size:3rem;margin-bottom:20px}.letter-card h1{font-family:"Great Vibes",cursive;color:#5c3a1e;font-size:2.2rem;font-weight:400;margin-bottom:24px;letter-spacing:1px}.letter-text{font-family:"Caveat",cursive;color:var(--text-color);font-size:1.4rem;margin-bottom:30px;white-space:pre-wrap;text-align:left}.audio-section{margin-top:24px;padding-top:24px;border-top:1px solid rgba(107,90,62,0.3)}.audio-label{color:#5c3a1e;font-size:0.9rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}audio{width:100%;margin-top:8px}.footer{margin-top:30px;color:var(--text-muted);font-size:0.8rem}.footer a{color:#5c3a1e;text-decoration:none}.empty{color:var(--text-muted);font-size:1rem;padding:40px 0}.empty-icon{font-size:3rem;margin-bottom:16px}@media(max-width:768px){.letter-card{margin-left:200px;margin-top:-80px;max-width:400px;padding:40px 30px}.letter-card h1{font-size:1.8rem}.letter-text{font-size:1.2rem}}@media(max-width:480px) and (orientation:portrait){body{background-size:contain;background-position:center center;background-attachment:scroll;padding:10px;min-height:100vh}.letter-card{margin-left:0;margin-top:0;max-width:80%;padding:20px 15px}.letter-card h1{font-size:1.2rem;margin-bottom:16px}.letter-text{font-size:1rem}.letter-icon{font-size:2rem;margin-bottom:12px}.audio-section{margin-top:16px;padding-top:16px}}@media(max-width:900px) and (orientation:landscape){body{background-size:contain;background-position:center center;background-attachment:scroll;padding:10px 20px;min-height:100vh}.letter-card{margin-left:0;margin-top:0;max-width:55%;padding:15px 25px}.letter-card h1{font-size:1.3rem;margin-bottom:14px}.letter-text{font-size:1rem}.letter-icon{font-size:2rem;margin-bottom:10px}.audio-section{margin-top:14px;padding-top:14px}audio{margin-top:6px}}</style></head><body><div class="letter-card">' + body + '</div></body></html>';
}

function gateHTML(title, error) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password - V I Key</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background-col
