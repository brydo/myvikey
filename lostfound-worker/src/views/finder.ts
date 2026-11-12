import { esc, html } from "../lib/html.ts";
import { TEMPERS } from "../lib/validate.ts";
import type { TagRecord } from "../types.ts";
import { LINKS_JS } from "./links.ts";

export function finderView(id: string, rec: TagRecord, lost: boolean, siteKey: string, canReveal: boolean): Response {
  const label = rec.kind === "pet" ? "pet" : "item";
  return html(
    `Found ${rec.name}`,
    (n) => `
<div id="finder" data-id="${esc(id)}" data-name="${esc(rec.name)}" data-kind="${esc(rec.kind)}" data-sitekey="${esc(siteKey)}">
${lost ? `<div class="banner">🚨 This ${label} has been reported LOST. Please contact the owner.</div>` : ""}
<h1>${esc(rec.name)}</h1>
<div class="card">
${rec.desc ? `<p>${esc(rec.desc)}</p>` : ""}
${rec.kind === "pet" && rec.temper in TEMPERS ? `<p><strong>Temperament:</strong> ${esc(TEMPERS[rec.temper])}</p>` : ""}
${rec.needs ? `<p><strong>Care needs:</strong> ${esc(rec.needs)}</p>` : ""}
${rec.note ? `<p><strong>Message from the owner:</strong><br>${esc(rec.note).replace(/\n/g, "<br>")}</p>` : ""}
</div>
${
  canReveal
    ? `<button class="btn" id="contactBtn" type="button">Contact the owner</button>
<div id="ts"></div>
<div id="result" class="hidden card">
<a class="btn hidden" id="b-call">Call</a>
<a class="btn hidden" id="b-whatsapp">WhatsApp</a>
<a class="btn hidden" id="b-sms">Text</a>
<label class="opt"><input type="checkbox" id="locbox"> Include my location in the message</label>
<p class="small">Your location is added by your own phone and is never sent to us.</p>
</div>`
    : `<div class="card">The owner has chosen to be contactable only while this ${label} is marked lost.</div>`
}
<p class="small" id="status" role="status"></p>
</div>
${
  canReveal
    ? `<script nonce="${n}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<script nonce="${n}">${LINKS_JS}
(function(){
var root=document.getElementById('finder'),btn=document.getElementById('contactBtn'),status=document.getElementById('status'),box=document.getElementById('locbox');
var data=null,loc=null;
function setLinks(){var l=vkLinks(data.number,root.dataset.name,root.dataset.kind,loc);data.methods.forEach(function(m){var e=document.getElementById('b-'+m);if(e){e.href=l[m];e.classList.remove('hidden')}})}
function onToken(token){
  status.textContent='';
  fetch('/found/'+root.dataset.id+'/reveal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:token})})
  .then(function(r){if(r.status===429)throw 'Too many attempts. Please try again later.';if(!r.ok)throw 'Contact details are not available right now.';return r.json()})
  .then(function(d){data=d;document.getElementById('ts').classList.add('hidden');document.getElementById('result').classList.remove('hidden');setLinks()})
  .catch(function(e){status.textContent=typeof e==='string'?e:'Something went wrong. Please try again.';btn.classList.remove('hidden')});
}
btn.onclick=function(){
  if(!window.turnstile){status.textContent='The security check is still loading. Please try again in a moment.';return}
  btn.classList.add('hidden');
  window.turnstile.render('#ts',{sitekey:root.dataset.sitekey,callback:onToken});
};
box.onchange=function(){
  if(!box.checked){loc=null;setLinks();return}
  if(!navigator.geolocation){box.checked=false;status.textContent='Location is not available on this device.';return}
  navigator.geolocation.getCurrentPosition(function(p){loc={lat:p.coords.latitude.toFixed(5),lng:p.coords.longitude.toFixed(5)};setLinks()},function(){box.checked=false;status.textContent='Could not get your location.'});
};
})();</script>`
    : ""
}`,
    200,
    canReveal,
  );
}
