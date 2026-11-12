import { decryptText } from "../lib/crypto.ts";
import { json } from "../lib/html.ts";
import { getTag, isLost, rateLimit } from "../lib/kv.ts";
import { verifyTurnstile } from "../lib/turnstile.ts";
import { notFoundView } from "../views/notfound.ts";
import type { Env } from "../types.ts";

export async function handleReveal(req: Request, env: Env, id: string): Promise<Response> {
  const rec = await getTag(env, id);
  if (!rec || rec.status !== "active") return notFoundView();

  // Rate limit first so scraping is slowed even when tokens are valid.
  if (!(await rateLimit(env, id, "reveal", 10))) return json({ error: "rate_limited" }, 429);

  let token: unknown;
  try {
    if (Number(req.headers.get("content-length") ?? "0") > 4096) throw new Error("big");
    token = ((await req.json()) as { token?: unknown }).token;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, token))) return json({ error: "turnstile" }, 403);

  if (!(rec.revealMode === "always" || (rec.revealMode === "lostonly" && isLost(rec)))) return notFoundView();

  const number = await decryptText(env.ENCRYPTION_KEY, rec.phoneEnc);
  return json({ number, methods: rec.contactMethods });
}
