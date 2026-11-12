import type { Env, TagRecord } from "../types.ts";

const tagKey = (id: string) => `lf:tag:${id}`;

export async function getTag(env: Env, id: string): Promise<TagRecord | null> {
  return env.TAGS.get<TagRecord>(tagKey(id), "json");
}

export async function putTag(env: Env, id: string, rec: TagRecord): Promise<void> {
  await env.TAGS.put(tagKey(id), JSON.stringify(rec));
}

/** Deletes the tag record and every related key (rate-limit counters). */
export async function deleteTag(env: Env, id: string): Promise<void> {
  await env.TAGS.delete(tagKey(id));
  let cursor: string | undefined;
  do {
    const res = await env.TAGS.list({ prefix: `lf:rl:${id}:`, cursor });
    await Promise.all(res.keys.map((k) => env.TAGS.delete(k.name)));
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
}

/** Per-tag hourly counter. Returns false once the limit is exceeded. */
export async function rateLimit(env: Env, id: string, scope: string, limit: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 3_600_000);
  const key = `lf:rl:${id}:${scope}:${bucket}`;
  const n = parseInt((await env.TAGS.get(key)) ?? "0", 10) || 0;
  if (n >= limit) return false;
  await env.TAGS.put(key, String(n + 1), { expirationTtl: 3700 });
  return true;
}

export const isLost = (rec: TagRecord, now = Date.now()) => rec.lost && rec.lostUntil > now;
