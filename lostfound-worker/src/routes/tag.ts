import { newManageSecret, encryptText, sha256Hex, timingSafeEqual } from "../lib/crypto.ts";
import { getTag, isLost, putTag, rateLimit } from "../lib/kv.ts";
import { normaliseClaimCode, parseDetails, readForm } from "../lib/validate.ts";
import { notFoundView } from "../views/notfound.ts";
import { claimView, claimedView } from "../views/claim.ts";
import { finderView } from "../views/finder.ts";
import type { Env } from "../types.ts";

export async function handleTagGet(env: Env, id: string): Promise<Response> {
  const rec = await getTag(env, id);
  if (!rec) return notFoundView();
  if (rec.status === "unclaimed") return claimView(id);
  const lost = isLost(rec);
  return finderView(id, rec, lost, env.TURNSTILE_SITE_KEY, rec.revealMode === "always" || lost);
}

export async function handleClaim(req: Request, env: Env, id: string): Promise<Response> {
  const rec = await getTag(env, id);
  if (!rec || rec.status !== "unclaimed" || !rec.claimHash) return notFoundView();

  const form = await readForm(req);
  if (!form) return claimView(id, ["Form data was too large."], undefined, 413);

  // Limits guessing of claim codes.
  if (!(await rateLimit(env, id, "claim", 10))) {
    return claimView(id, ["Too many attempts. Please try again in an hour."], undefined, 429);
  }

  const parsed = parseDetails(form);
  const code = normaliseClaimCode(form.get("code"));
  const hash = await sha256Hex(env.ADMIN_HASH_SALT, code);
  const codeOk = timingSafeEqual(hash, rec.claimHash);

  if (!parsed.ok) {
    const errors = codeOk ? parsed.errors : ["That claim code isn't right.", ...parsed.errors];
    return claimView(id, errors, { ...(parsed.raw as any), phone: String(form.get("phone") ?? "").slice(0, 30) }, 400);
  }
  if (!codeOk) {
    return claimView(id, ["That claim code isn't right."], { ...parsed.value }, 403);
  }

  const v = parsed.value;
  const secret = newManageSecret();
  await putTag(env, id, {
    ...rec,
    status: "active",
    claimHash: null,
    manageHash: await sha256Hex(env.ADMIN_HASH_SALT, secret),
    kind: v.kind,
    name: v.name,
    desc: v.desc,
    needs: v.needs,
    temper: v.temper,
    note: v.note,
    phoneEnc: await encryptText(env.ENCRYPTION_KEY, v.phone),
    contactMethods: v.contactMethods,
    revealMode: v.revealMode,
    lost: false,
    lostUntil: 0,
    claimedAt: Date.now(),
  });
  return claimedView(env.PUBLIC_BASE_URL, id, secret, v);
}
