async function hash(str){const data=new TextEncoder().encode(str);const buf=await crypto.subtle.digest('SHA-256',data);return[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32)}

function escapeHtml(str){if(!str)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}

function letterHTML(id,content){
  var body='<div class="letter-icon">🎄</div>';
  if(content&&content.text){
    body+='<h1>Your Christmas Letter</h1><div class="letter-text">'+escapeHtml(content.text)+'</div>';
  }
  if(content&&content.audioUrl){
    body+='<div class="audio-section"><div class="audio-label">🎵 Listen to your letter</div><audio controls preload="metadata"><source src="'+escapeHtml(content.audioUrl)+'" type="audio/mpeg"></audio></div>';
  }
  if(!content||(!content.text&&!content.audioUrl)){
    body='<div class="empty-icon">🎄</div><div class="empty">This letter is not ready yet. Please check back soon.</div>';
  }
  return'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Christmas Letter · '+escapeHtml(id)+' · V I Key®</title><style>:root{--bg-color:#121212;--card-bg:#1a1a1a;--gold:#d4af37;--text-color:#e0e0e0;--text-muted:#aaaaaa}*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background-color:var(--bg-color);color:var(--text-color);line-height:1.8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.letter-card{background-color:var(--card-bg);border:1px solid #2a2a2a;border-radius:12px;padding:40px 32px;max-width:500px;width:100%;text-align:center}.letter-icon{font-size:3rem;margin-bottom:20px}.letter-card h1{color:var(--gold);font-size:1.5rem;font-weight:500;margin-bottom:24px;letter-spacing:1px}.letter-text{color:var(--text-color);font-size:1.05rem;margin-bottom:30px;white-space:pre-wrap;text-align:left}.audio-section{margin-top:24px;padding-top:24px;border-top:1px solid #2a2a2a}.audio-label{color:var(--gold);font-size:0.9rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}audio{width:100%;margin-top:8px}.footer{margin-top:30px;color:var(--text-muted);font-size:0.8rem}.footer a{color:var(--gold);text-decoration:none}.empty{color:var(--text-muted);font-size:1rem;padding:40px 0}.empty-icon{font-size:3rem;margin-bottom:16px}@media(max-width:480px){.letter-card{padding:30px 20px}.letter-card h1{font-size:1.3rem}.letter-text{font-size:1rem}}</style></head><body><div class="letter-card">'+body+'<div class="footer"><a href="https://wa.me/447526345287">V I Key®</a></div></div></body></html>';
}

function gateHTML(title,error){
  return'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password · V I Key®</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background-color:#121212;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;line-height:1.6}.gate-card{background-color:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:40px 32px;max-width:380px;width:100%;text-align:center}.gate-icon{font-size:2.5rem;margin-bottom:16px}.gate-card h1{color:#d4af37;font-size:1.3rem;font-weight:500;margin-bottom:8px;letter-spacing:1px}.gate-card p{color:#aaa;font-size:0.95rem;margin-bottom:24px}.gate-card input{width:100%;padding:14px 16px;font-size:1rem;background-color:#121212;color:#e0e0e0;border:1px solid #333;border-radius:8px;margin-bottom:16px;outline:none;transition:border-color 0.3s}.gate-card input:focus{border-color:#d4af37}.gate-card button{width:100%;padding:14px;font-size:1rem;font-weight:600;color:#d4af37;background-color:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);border-radius:8px;cursor:pointer;transition:background-color 0.3s,box-shadow 0.3s}.gate-card button:hover{background-color:rgba(212,175,55,0.2);box-shadow:0 0 20px rgba(212,175,55,0.15)}.gate-error{color:#ff6b6b;font-size:0.9rem;margin-bottom:16px}</style></head><body><div class="gate-card"><div class="gate-icon">🔒</div><h1>'+escapeHtml(title)+'</h1><p>Please enter the password to continue.</p>'+(error?'<div class="gate-error">Incorrect password. Please try again.</div>':'')+'<form method="POST" action=""><input type="password" name="password" placeholder="Password" autofocus required><button type="submit">Unlock Page →</button></form></div></body></html>';
}

export async function onRequest(context){
  var request=context.request,env=context.env,next=context.next;
  try{
    var url=new URL(request.url);
    if(url.pathname.startsWith('/xmasletters/api/'))return next();
    if(url.pathname==='/xmasletters/admin'||url.pathname==='/xmasletters/admin.html'){
      var adminPassword=await env.PAGE_PASSWORDS.get('__admin__');
      if(!adminPassword)return next();
      var expectedAdminHash=await hash('__admin__:'+adminPassword);
      var cookies=request.headers.get('Cookie')||'';
      var adminCookieMatch=cookies.split(';').some(function(c){return c.trim()==='auth___admin__='+expectedAdminHash});
      if(request.method==='POST'){
        var formData=await request.formData();
        var submittedPassword=formData.get('password');
        if(submittedPassword===adminPassword){
          return new Response(null,{status:302,headers:{'Location':url.pathname,'Set-Cookie':'auth___admin__='+expectedAdminHash+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400'}});
        }else{
          return new Response(gateHTML('Admin Access',true),{status:401,headers:{'Content-Type':'text/html; charset=utf-8'}});
        }
      }
      if(adminCookieMatch)return next();
      return new Response(gateHTML('Admin Access',false),{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
    var pageId=url.searchParams.get('id');
    if(!pageId)return next();
    var content=null;
    var rawContent=await env.XMAS_CONTENT.get(pageId);
    if(rawContent){try{content=JSON.parse(rawContent)}catch(e){content=null}}
    var storedPassword=await env.PAGE_PASSWORDS.get(pageId);
    if(!storedPassword){
      return new Response(letterHTML(pageId,content),{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
    var expectedCookieValue=await hash(pageId+':'+storedPassword);
    var cookieName='auth_'+pageId;
    if(request.method==='POST'){
      var formData=await request.formData();
      var submittedPassword=formData.get('password');
      if(submittedPassword===storedPassword){
        var redirectUrl=url.pathname+url.search;
        return new Response(null,{status:302,headers:{'Location':redirectUrl,'Set-Cookie':cookieName+'='+expectedCookieValue+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400'}});
      }else{
        return new Response(gateHTML('This Page is Protected',true),{status:401,headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
    }
    var cookies=request.headers.get('Cookie')||'';
    var cookieMatch=cookies.split(';').some(function(c){return c.trim()===cookieName+'='+expectedCookieValue});
    if(cookieMatch){
      return new Response(letterHTML(pageId,content),{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
    return new Response(gateHTML('This Page is Protected',false),{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}})_
