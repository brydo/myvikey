import type { Method, RevealMode } from "../types.ts";

export const TEMPERS: Record<string, string> = {
  friendly: "Friendly",
  shy: "Shy (approach gently)",
  nervous: "Nervous (may bolt)",
  nochase: "Do not chase (call me)",
};

export interface Details {
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

/** Returns E.164 (+447...) or null. Accepts 07..., +44..., 0044..., +44 (0)7... */
export function normalisePhone(input: string): string | null {
  let n = input.replace(/[\s\-().]/g, "");
  if (n.startsWith("+440")) n = "+44" + n.slice(4);
  if (n.startsWith("00")) n = "+" + n.slice(2);
  else if (n.startsWith("0")) n = "+44" + n.slice(1);
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

function text(form: FormData, key: string, max: number, required: boolean, errors: string[], label: string): string {
  const raw = form.get(key);
  const v = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (CONTROL.test(v)) errors.push(`${label} contains invalid characters.`);
  else if (v.length > max) errors.push(`${label} must be ${max} characters or fewer.`);
  else if (required && !v) errors.push(`${label} is required.`);
  return v;
}

export function parseDetails(form: FormData): { ok: true; value: Details } | { ok: false; errors: string[]; raw: Partial<Details> } {
  const errors: string[] = [];
  const kindRaw = form.get("kind");
  const kind = kindRaw === "item" ? "item" : kindRaw === "pet" ? "pet" : null;
  if (!kind) errors.push("Choose pet or item.");

  const name = text(form, "name", 40, true, errors, "Name");
  const desc = text(form, "desc", 120, false, errors, "Description");
  const needs = kind === "pet" ? text(form, "needs", 120, false, errors, "Care needs") : "";
  const note = text(form, "note", 200, false, errors, "Note");

  let temper = "";
  if (kind === "pet") {
    const t = form.get("temper");
    if (typeof t === "string" && t in TEMPERS) temper = t;
    else errors.push("Choose a temperament.");
  }

  const phoneRaw = form.get("phone");
  const phone = typeof phoneRaw === "string" && phoneRaw.length <= 30 ? normalisePhone(phoneRaw) : null;
  if (!phone) errors.push("Enter a valid mobile number, e.g. 07123 456789 or +44 7123 456789.");

  const contactMethods = (["call", "whatsapp", "sms"] as Method[]).filter((m) => form.getAll("methods").includes(m));
  if (contactMethods.length === 0) errors.push("Choose at least one contact method.");

  const rm = form.get("revealMode");
  const revealMode: RevealMode | null = rm === "always" || rm === "lostonly" ? rm : null;
  if (!revealMode) errors.push("Choose when the finder can contact you.");

  if (errors.length || !kind || !phone || !revealMode) {
    return { ok: false, errors, raw: { kind: kind ?? "pet", name, desc, needs, temper, note, contactMethods, revealMode: revealMode ?? "always" } };
  }
  return { ok: true, value: { kind, name, desc, needs, temper, note, phone, contactMethods, revealMode } };
}

export function normaliseClaimCode(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\s-]/g, "").toUpperCase().slice(0, 16) : "";
}

export const ID_RE = /^[a-z2-7]{10,32}$/;
export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/** Reads a urlencoded form body with a size cap. */
export async function readForm(req: Request): Promise<FormData | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 8192) return null;
  const body = await req.text();
  if (body.length > 8192) return null;
  const form = new FormData();
  for (const [k, v] of new URLSearchParams(body)) form.append(k, v);
  return form;
}
