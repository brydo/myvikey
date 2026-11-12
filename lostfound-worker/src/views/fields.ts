import { esc } from "../lib/html.ts";
import { TEMPERS } from "../lib/validate.ts";
import type { Method, RevealMode } from "../types.ts";

export interface FieldValues {
  kind: "pet" | "item";
  name: string;
  desc: string;
  needs: string;
  temper: string;
  note: string;
  phone: string;
  contactMethods: Method[];
  revealMode: RevealMode;
}

export const emptyValues: FieldValues = {
  kind: "pet",
  name: "",
  desc: "",
  needs: "",
  temper: "friendly",
  note: "",
  phone: "",
  contactMethods: ["call", "whatsapp", "sms"],
  revealMode: "always",
};

export function detailsFields(v: FieldValues): string {
  const m = (x: Method) => (v.contactMethods.includes(x) ? " checked" : "");
  const sel = (a: string, b: string) => (a === b ? " selected" : "");
  const temperOpts = Object.entries(TEMPERS)
    .map(([k, label]) => `<option value="${k}"${sel(v.temper, k)}>${esc(label)}</option>`)
    .join("");
  return `
<label for="kind">This tag is for a</label>
<select id="kind" name="kind"><option value="pet"${sel(v.kind, "pet")}>Pet</option><option value="item"${sel(v.kind, "item")}>Item</option></select>

<label for="name">Name <span class="hint">(pet name or item label, max 40)</span></label>
<input type="text" id="name" name="name" maxlength="40" required value="${esc(v.name)}">

<label for="desc">Description <span class="hint">(max 120)</span></label>
<input type="text" id="desc" name="desc" maxlength="120" value="${esc(v.desc)}">

<div class="pet-only">
<label for="needs">Care needs <span class="hint">(optional, max 120)</span></label>
<input type="text" id="needs" name="needs" maxlength="120" value="${esc(v.needs)}">

<label for="temper">Temperament</label>
<select id="temper" name="temper">${temperOpts}</select>
</div>

<label for="note">Note for the finder <span class="hint">(max 200)</span></label>
<textarea id="note" name="note" maxlength="200">${esc(v.note)}</textarea>

<label for="phone">Your mobile number</label>
<input type="tel" id="phone" name="phone" maxlength="30" required autocomplete="tel" value="${esc(v.phone)}">
<div class="hint">Stored encrypted. Only shown to a finder who passes a bot check.</div>

<label>How can a finder contact you?</label>
<label class="opt"><input type="checkbox" name="methods" value="call"${m("call")}> Call</label>
<label class="opt"><input type="checkbox" name="methods" value="whatsapp"${m("whatsapp")}> WhatsApp</label>
<label class="opt"><input type="checkbox" name="methods" value="sms"${m("sms")}> Text message</label>

<label>When can a finder contact you?</label>
<label class="opt"><input type="radio" name="revealMode" value="always"${v.revealMode === "always" ? " checked" : ""}> Always (recommended: a finder can reach you before you know your pet is missing)</label>
<label class="opt"><input type="radio" name="revealMode" value="lostonly"${v.revealMode === "lostonly" ? " checked" : ""}> Only while the tag is marked lost</label>`;
}

export const KIND_TOGGLE_JS = `
(function(){var k=document.getElementById('kind');function f(){document.querySelectorAll('.pet-only').forEach(function(e){e.classList.toggle('hidden',k.value!=='pet')})}k.addEventListener('change',f);f()})();
`;
