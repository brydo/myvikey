# V I Key® — Changes for Per-Event Backgrounds

These are the changes needed to your **existing files** to support per-event backgrounds.
The new order pages and order API are ready to go as-is.

---

## 1. Replace `rsvp/theme-client.js`

A complete updated version is provided as `rsvp/theme-client.updated.js`.

**What changed:** Added `applyEvent(root, type, eventBackground)` function and exposed it as `RSVPThemes.applyEvent`. This lets a specific event override the category background without affecting other events.

**To apply:** Replace the contents of `rsvp/theme-client.js` with `rsvp/theme-client.updated.js`, then rename the import in the file from `./themes.js` (it stays the same — no import change needed).

---

## 2. Modify `rsvp/rsvp.js` (2 changes)

### Change A — Update `applyTheme` to accept an event background

Find this function (near the top):

```js
function applyTheme(type) {
    type = theme(type);
    window.RSVPThemes.apply(document.body, type);
}
```

Replace with:

```js
function applyTheme(type, eventBackground) {
    type = theme(type);
    if (eventBackground) {
        window.RSVPThemes.applyEvent(document.body, type, eventBackground);
    } else {
        window.RSVPThemes.apply(document.body, type);
    }
}
```

### Change B — Pass the invitation's background when loading

Find this line inside `loadInvitation` (after `invitation = data.invitation;`):

```js
applyTheme(invitation.eventType);
```

Replace with:

```js
applyTheme(invitation.eventType, invitation.backgroundImage);
```

That's it for `rsvp.js` — two small changes.

---

## 3. Modify `functions/api/rsvp.js` (3 changes)

### Change A — Import `safeBackground`

Find the existing import from themes.js:

```js
import { eventTypes, theme, normalizeAppearance, validateAppearance, styleIssues } from '../../rsvp/themes.js';
```

Add `safeBackground` to the import:

```js
import { eventTypes, theme, normalizeAppearance, validateAppearance, styleIssues, safeBackground } from '../../rsvp/themes.js';
```

### Change B — Add `backgroundImage` to `invitationFields`

Find the `invitationFields` function. After the whatsapp/sms validation block (before `return result`), add:

```js
if (body.backgroundImage !== undefined) {
    if (typeof body.backgroundImage !== 'string' || !safeBackground(body.backgroundImage)) return null;
    result.backgroundImage = body.backgroundImage;
}
```

### Change C — Return `backgroundImage` in `invitationDTO`

Find the `invitationDTO` function:

```js
function invitationDTO(invitation, id) {
  const { title, text, whatsapp = '', sms = '', invitesSent = 0 } = invitation;
  return { id, eventType: theme(invitation.eventType),
    title, text, whatsapp, sms, invitesSent, passwordProtected: !!invitation.guestPasswordHash,
    hostPasswordProtected: !!invitation.hostPasswordHash };
}
```

Replace with:

```js
function invitationDTO(invitation, id) {
  const { title, text, whatsapp = '', sms = '', invitesSent = 0, backgroundImage = '' } = invitation;
  return { id, eventType: theme(invitation.eventType),
    title, text, whatsapp, sms, invitesSent, backgroundImage,
    passwordProtected: !!invitation.guestPasswordHash,
    hostPasswordProtected: !!invitation.hostPasswordHash };
}
```

---

## 4. Modify `rsvp/admin.html` (2 changes)

### Change A — Add background field to the invitation form

Find the SMS field in the invitation form:

```html
<label for="sms">Host text/SMS number (optional)</label>
<input id="sms" name="sms" type="tel" maxlength="16" pattern="\+[1-9][0-9]{7,14}" placeholder="+447700900123" aria-describedby="contactHint">
```

After the `<p id="contactHint">…</p>` paragraph that follows it, add:

```html
<label for="eventBackground">Event background image URL (optional, HTTPS)</label>
<input id="eventBackground" name="eventBackground" type="url" maxlength="2048" placeholder="https://example.com/wedding-bg.jpg" aria-describedby="eventBackgroundHint">
<p id="eventBackgroundHint">Set a background image for this specific event. Leave blank to use the category default. Use a trusted, publicly accessible HTTPS image URL.</p>
```

### Change B — Update the admin JavaScript

In the admin script (inside the `<script>` tag at the bottom of admin.html):

**In `showInvitation`** — find where form fields are populated:

```js
['id', 'title', 'text', 'whatsapp', 'sms'].forEach(function (field) {
    editor.elements[field].value = invitation[field] || '';
});
```

Change to:

```js
['id', 'title', 'text', 'whatsapp', 'sms'].forEach(function (field) {
    editor.elements[field].value = invitation[field] || '';
});
editor.elements.eventBackground.value = invitation.backgroundImage || '';
```

**In the save handler** — find where the payload is built:

```js
['title', 'text', 'whatsapp', 'sms'].forEach(function (field) {
    payload[field] = editor.elements[field].value.trim();
});
```

Add after it:

```js
payload.backgroundImage = editor.elements.eventBackground.value.trim();
```

---

## Summary

| File | Change | Risk |
|---|---|---|
| `rsvp/theme-client.js` | Replace with updated version (adds `applyEvent`) | Low — new method, existing methods unchanged |
| `rsvp/rsvp.js` | 2 small edits (pass background to `applyTheme`) | Low — additive |
| `functions/api/rsvp.js` | 3 small edits (store/return `backgroundImage`) | Low — additive, existing fields untouched |
| `rsvp/admin.html` | 2 small edits (add field + wire up in JS) | Low — additive |

**If an event has no `backgroundImage` set, everything works exactly as before** — it falls back to the category default. No existing functionality is changed.
