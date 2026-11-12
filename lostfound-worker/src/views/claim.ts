import { esc, html } from "../lib/html.ts";
import { LINKS_JS } from "./links.ts";
import { KIND_TOGGLE_JS, detailsFields, emptyValues, type FieldValues } from "./fields.ts";

export function claimView(id: string, errors: string[] = [], values: FieldValues = emptyValues, status = 200): Response {
  return html(
    "Activate your tag",
    (n) => `
<h1>Activate your V I Key® tag</h1>
<p>Enter the claim code from your card and tell us what this tag is for.</p>
${errors.length ? `<div class="err">${errors.map((e) => `<div>${esc(e)}</div>`).join("")}</div>` : ""}
<form class="card" method="post" action="/found/${esc(id)}/claim" autocomplete="off">
<label for="code">Claim code</label>
<input type="text" id="code" name="code" required maxlength="16" autocapitalize="characters" autocomplete="off">
${detailsFields(values)}
<p class="small">We store only what you enter here, to help a finder return your pet or item. No tracking, no cookies. See our <a href="https://vi-key.uk/privacy/">privacy notice</a>.</p>
<button class="btn" type="submit">Activate tag</button>
</form>
<script nonce="${n}">${KIND_TOGGLE_JS}</script>`,
    status,
  );
}

export function claimedView(base: string, id: string, secret: string, v: FieldValues & { phone: string }): Response {
  const manageUrl = `${base}/manage/${id}/${secret}`;
  return html(
    "Tag activated",
    (n) => `
<h1>Tag activated ✅</h1>
<div class="card">
<h2>Save your private manage link</h2>
<p><strong>This is the only time it is shown.</strong> There are no accounts or passwords: anyone with this link can edit or delete your tag, and if you lose it we cannot recover it.</p>
<div class="mono" id="mlink">${esc(manageUrl)}</div>
<button class="btn sec" type="button" id="copy">Copy link</button>
</div>
<div class="card" id="test" data-number="${esc(v.phone)}" data-name="${esc(v.name)}" data-kind="${esc(v.kind)}">
<h2>Check your contact buttons</h2>
<p class="small">Tap each one to make sure it opens on your phone. Finders will see these buttons.</p>
${v.contactMethods.includes("call") ? `<a class="btn" id="t-call">Call</a>` : ""}
${v.contactMethods.includes("whatsapp") ? `<a class="btn" id="t-whatsapp">WhatsApp</a>` : ""}
${v.contactMethods.includes("sms") ? `<a class="btn" id="t-sms">Text</a>` : ""}
</div>
<a class="btn sec" href="/manage/${esc(id)}/${esc(secret)}">Go to manage page</a>
<script nonce="${n}">${LINKS_JS}
(function(){
var t=document.getElementById('test');var l=vkLinks(t.dataset.number,t.dataset.name,t.dataset.kind,null);
['call','whatsapp','sms'].forEach(function(m){var e=document.getElementById('t-'+m);if(e)e.href=l[m]});
document.getElementById('copy').onclick=function(){var s=document.getElementById('mlink').textContent;if(navigator.clipboard)navigator.clipboard.writeText(s).then(function(){document.getElementById('copy').textContent='Copied'})};
})();</script>`,
    200,
  );
}
