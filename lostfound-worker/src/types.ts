export interface Env {
  TAGS: KVNamespace;
  PUBLIC_BASE_URL: string;
  LOST_MODE_DAYS: string;
  TURNSTILE_SITE_KEY: string;
  ENCRYPTION_KEY: string;
  ADMIN_HASH_SALT: string;
  TURNSTILE_SECRET: string;
}

export type Method = "call" | "whatsapp" | "sms";
export type RevealMode = "always" | "lostonly";

export interface TagRecord {
  status: "unclaimed" | "active";
  claimHash: string | null;
  manageHash: string | null;
  kind: "pet" | "item";
  name: string;
  desc: string;
  needs: string;
  temper: string;
  note: string;
  phoneEnc: string;
  contactMethods: Method[];
  revealMode: RevealMode;
  lost: boolean;
  lostUntil: number;
  createdAt: number;
  claimedAt: number;
}
