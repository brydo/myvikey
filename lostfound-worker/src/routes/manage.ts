import { decryptText, encryptText, sha256Hex, timingSafeEqual } from "../lib/crypto.ts";
import { deleteTag, getTag, isLost, putTag } from "../lib/kv.ts";
import { parseDetails, readForm, SECRET_RE } from "../lib/validate.ts";
import { deletedView, manageView } from "../views/manage.ts";
import { notFoundView } from "../views/notfound.ts";
import type { Env, TagRecord } from "../types.ts";

async function authorise(env: Env, id: string, secret: string): Promise<TagRecord | null> {
  const rec = await getTag(env, id);
  const given = await sha256Hex(env.ADMIN_HASH_SALT, SECRET_RE.test(secret) ? secret : "invalid");
  const ok = timingSafeEqual(given, rec?.manageHash ?? "");
  return rec && rec.status === "active" && ok ? rec : null;
}

async function render(env: Env, id: string, secret: string, rec: TagRecord, messages: string[] = [], errors: string[] = [], status = 200) {
  const phone = await decryptText(env.ENCRYPTION_KEY, rec.phoneEnc);
  const lostDays = parseInt(env.LOST_MODE_DAYS, 10) || 14;
  return manageView(id, secret, { ...rec, phone }, isLost(rec), rec.lostUntil, { messages, errors, lostDays }, status);
}

export async function handleManage(req: Request, env: Env, id: string, secret: string, action: string | undefined): Promise<Response> {
  const rec = await authorise(env, id, secret);
  if (!rec) return notFoundView();

  if (req.method === "GET" && !action) return render(env, id, secret, rec);
  if (req.method !== "POST" || !action) return notFoundView();

  const form = await readForm(req);
  if (!form) return render(env, id, secret, rec, [], ["Form data was too large."], 413);

  switch (action) {
    case "update": {
      const parsed = parseDetails(form);
      if (!parsed.ok) return render(env, id, secret, rec, [], parsed.errors, 400);
      const v = parsed.value;
      const next: TagRecord = {
        ...rec,
        kind: v.kind,
        name: v.name,
        desc: v.desc,
        needs: v.needs,
        temper: v.temper,
        note: v.note,
        phoneEnc: await encryptText(env.ENCRYPTION_KEY, v.phone),
        contactMethods: v.contactMethods,
        revealMode: v.revealMode,
      };
      await putTag(env, id, next);
      return render(env, id, secret, next, ["Saved."]);
    }
    case "lost": {
      const days = parseInt(env.LOST_MODE_DAYS, 10) || 14;
      const next = { ...rec, lost: true, lostUntil: Date.now() + days * 86_400_000 };
      await putTag(env, id, next);
      return render(env, id, secret, next, ["Lost mode is on."]);
    }
    case "found": {
      const next = { ...rec, lost: false, lostUntil: 0 };
      await putTag(env, id, next);
      return render(env, id, secret, next, ["Marked as found. Glad they're safe!"]);
    }
    case "delete": {
      if (form.get("confirm") !== "yes") return render(env, id, secret, rec, [], ["Please tick the box to confirm deletion."], 400);
      await deleteTag(env, id);
      return deletedView();
    }
    default:
      return notFoundView();
  }
}
