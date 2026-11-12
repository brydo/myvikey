import { dateGB, esc, html } from "../lib/html.ts";
import { KIND_TOGGLE_JS, detailsFields, type FieldValues } from "./fields.ts";

export function manageView(
  id: string,
  secret: string,
  v: FieldValues,
  lost: boolean,
  lostUntil: number,
  opts: { messages?: string[]; errors?: string[]; lostDays: number } = { lostDays: 14 },
  status = 200,
): Response {
  const base = `/manage/${esc(id)}/${esc(secret)}`;
  return html(
    "Manage your tag",
    (n) => `
<h1>Manage your tag</h1>
${(opts.messages ?? []).map((m) => `<div class="okmsg">${esc(m)}</div>`).join("")}
${(opts.errors ?? []).map((m) => `<div class="err">${esc(m)}</div>`).join("")}
<p class="small">Changes can take up to about a minute to show for finders.</p>

<div class="card">
<h2>Lost mode</h2>
${
  lost
    ? `<div class="banner">Marked LOST until ${esc(dateGB(lostUntil))}</div>
<form method="post" action="${base}/lost"><button class="btn sec" type="submit">Renew for ${opts.lostDays} days</button></form>
<form method="post" action="${base}/found"><button class="btn" type="submit">Mark as found</button></form>`
    : `<p>Not marked lost. Lost mode shows a red alert to finders and switches off automatically after ${opts.lostDays} days.</p>
<form method="post" action="${base}/lost"><button class="btn danger" type="submit">Mark as lost</button></form>`
}
</div>

<form class="card" method="post" action="${base}/update" autocomplete="off">
<h2>Details</h2>
${detailsFields(v)}
<button class="btn" type="submit">Save changes</button>
</form>

<form class="card" method="post" action="${base}/delete">
<h2>Delete this tag</h2>
<p class="small">This permanently deletes all details and the tag can no longer be used.</p>
<label class="opt"><input type="checkbox" name="confirm" value="yes" required> Yes, permanently delete this tag</label>
<button class="btn danger" type="submit">Delete tag</button>
</form>
<script nonce="${n}">${KIND_TOGGLE_JS}</script>`,
    status,
  );
}

export function deletedView(): Response {
  return html("Tag deleted", () => `<h1>Tag deleted</h1><p>All details for this tag have been permanently removed.</p>`);
}
