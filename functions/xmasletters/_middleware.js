async function hash(str){const data=new TextEncoder().encode(str);const buf=await crypto.subtle.digest('SHA-256',data);return[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32)}

function gateHTML(id,error){return`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Enter Password · V I Key®</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background-color:#121212;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;line-height:1.6}.gate-card{background-color:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:40px 32px;max-width:380px;width:100%;text-align:center}.gate-icon{font-size:2.5rem;margin-bottom:16px}.gate-card h1{color:#d4af37;font-size:1.3rem;font-weight:500;margin-bottom:8px;letter-spacing:1px}.gate-card p{color:#aaa;font-size:0.95rem;margin-bottom:24px}.gate-card input{width:100%;padding:14px 16px;font-size:1rem;background-color:#121212;color:#e0e0e0;border:1px solid #333;border-radius:8px;margin-bottom:16px;outline:none;transition:border-color 0.3s}.gate-card input:focus{border-color:#d4af37}.gate-card button{width:100%;padding:14px;font-size:1rem;font-weight:600;color:#d4af37;background-color:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);border-radius:8px;cursor:pointer;transition:background-color 0.3s,box-shadow 0.3s}.gate-card button:hover{background-color:rgba(212,175,55,0.2);box-shadow:0 0 20px rgba(212,175,55,0.15)}.gate-error{color:#ff6b6b;font-size:0.9rem;margin-bottom:16px}</style></head><body><div class="gate-card"><div class="gate-icon">🔒</div><h1>${id}</h1><p>Please enter the password to continue.</p>${error?'<div class="gate-error">Incorrect password. Please try again.</div>':''}<form method="POST" action=""><input type="password" name="password" placeholder="Password" autofocus required><button type="submit">Unlock Page →</button></form></div></body></html>`}

export async function onRequest(context){
  const{request,env,next}=context;
  try{
    const url=new URL(request.url);
    
    // ── Skip API requests entirely ──
    if(url.pathname.startsWith('/xmasletters/api/'))return next();
    
    // ── Protect the admin page ──
    if(url.pathname==='/xmasletters/admin'||url.pathname==='/xmasletters/admin.html'){
      const adminPassword=await env.PAGE_PASSWORDS.get('__admin__');
      if(!adminPassword)return next();
      const expectedAdminHash=await hash('__admin__:'+adminPassword);
      const cookies=request.headers.get('Cookie')||'';
      const adminCookieMatch=cookies.split(';').some(c=>c.trim()===`auth___admin__=${expectedAdminHash}`);
      if(request.method==='POST'){
        const formData=await request.formData();
        const submittedPassword=formData.get('password');
        if(submittedPassword===adminPassword){
          return new Response(null,{status:302,headers:{'Location':url.pathname,'Set-Cookie':`auth___admin__=${expectedAdminHash}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`}});
        }else{
          return new Response(gateHTML('Admin Access',true),{status:401,headers:{'Content-Type':'text/html; charset=utf-8'}});
        }
      }
      if(adminCookieMatch)return next();
      return new Response(gateHTML('Admin Access',false),{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
    
    // ── Protect individual pages by ?id= ──
    const pageId=url.searchParams.get('id');
    if(!pageId)return next();
    const storedPassword=await env.PAGE_PASSWORDS.get(pageId);
    if(!storedPassword)return next();
    const expectedCookieValue=await hash(pageId+':'+storedPassword);
    const cookieName=`auth_${pageId}`;
    if(request.method==='POST'){
      const formData=await request.formData();
      const submittedPassword=formData.get('password');
      if(submittedPassword===storedPassword){
        const redirectUrl=url.pathname+url.search;
        return new Response(null,{status:302,headers:{'Location':redirectUrl,'Set-Cookie':`${cookieName}=${expectedCookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`}});
      }else{
        return new Response(gateHTML('This Page is Protected',true),{status:401,headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
    }
    const cookies=request.headers.get('Cookie')||'';
    const cookieMatch=cookies.split(';').some(c=>c.trim()===`${cookieName}=${expectedCookieValue}`);
    if(cookieMatch)return next();
    return new Response(gateHTML('This Page is Protected',false),{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
  }catch(e){
    return next();
  }
}
