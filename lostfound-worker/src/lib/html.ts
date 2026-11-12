export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"'`]/g, (c) => `&#${c.charCodeAt(0)};`);
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--fg:#1a1d21;--mute:#5c6670;--line:#d9dde2;--accent:#0b6bcb;--accent-fg:#fff;--danger:#c62828;--ok:#1b7f3b}
@media (prefers-color-scheme:dark){:root{--bg:#101316;--card:#1a1f24;--fg:#eef1f4;--mute:#a0a9b3;--line:#2f373f;--accent:#4c9bf0;--accent-fg:#06121f;--danger:#ef5350;--ok:#5cd685}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:520px;margin:0 auto;padding:16px}
h1{font-size:1.5rem;margin:.4em 0}h2{font-size:1.1rem;margin:1.2em 0 .4em}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
label{display:block;font-weight:600;margin:12px 0 4px}
.hint{color:var(--mute);font-size:.875rem;font-weight:400}
input[type=text],input[type=tel],select,textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
textarea{min-height:80px}
.opt{display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0}
.opt input{width:20px;height:20px}
.btn{display:block;width:100%;text-align:center;padding:12px 16px;margin:10px 0;border:0;border-radius:10px;background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.btn.sec{background:transparent;color:var(--fg);border:1px solid var(--line)}
.btn.danger{background:var(--danger);color:#fff}
.banner{background:var(--danger);color:#fff;border-radius:12px;padding:14px 16px;font-weight:700;font-size:1.1rem}
.err{border:1px solid var(--danger);color:var(--danger);border-radius:8px;padding:10px;margin:12px 0}
.okmsg{border:1px solid var(--ok);color:var(--ok);border-radius:8px;padding:10px;margin:12px 0}
.mono{font-family:ui-monospace,Menlo,monospace;word-break:break-all;background:var(--bg);padding:10px;border-radius:8px;border:1px solid var(--line)}
.small{font-size:.85rem;color:var(--mute)}
.hidden{display:none}
`;

export function nonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function baseHeaders(n: string, turnstile: boolean): Headers {
  const h = new Headers();
  const script = turnstile ? `'nonce-${n}' https://challenges.cloudflare.com` : `'nonce-${n}'`;
  const frame = turnstile ? "frame-src https://challenges.cloudflare.com; " : "";
  h.set(
    "Content-Security-Policy",
    `default-src 'none'; script-src ${script}; style-src 'nonce-${n}'; ${frame}connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  );
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cache-Control", "no-store");
  h.set("X-Robots-Tag", "noindex");
  h.set("Strict-Transport-Security", "max-age=31536000");
  return h;
}

export function html(title: string, body: (nonce: string) => string, status = 200, turnstile = false): Response {
  const n = nonce();
  const doc = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · V I Key®</title><style nonce="${n}">${CSS}</style></head><body><main>${body(n)}</main></body></html>`;
  const h = baseHeaders(n, turnstile);
  h.set("Content-Type", "text/html; charset=utf-8");
  return new Response(doc, { status, headers: h });
}

export function json(data: unknown, status = 200): Response {
  const h = baseHeaders("x", false);
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: h });
}

export const dateGB = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(ms));
