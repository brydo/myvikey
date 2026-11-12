const enc = new TextEncoder();

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Unbiased random string from an alphabet, using a cryptographic source. */
export function randomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of buf) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

export const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
// No 0/O, 1/I/L
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const newTagId = () => randomString(ID_ALPHABET, 12);
export const newClaimCode = () => randomString(CODE_ALPHABET, 8);
export const newManageSecret = () => toB64Url(crypto.getRandomValues(new Uint8Array(32)));

export async function sha256Hex(salt: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${value}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function aesKey(keyB64: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
}

/** AES-GCM with a fresh random IV. Output is base64(iv || ciphertext). */
export async function encryptText(keyB64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64, "encrypt"), enc.encode(plain)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function decryptText(keyB64: string, data: string): Promise<string> {
  const raw = fromB64(data);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    await aesKey(keyB64, "decrypt"),
    raw.slice(12),
  );
  return new TextDecoder().decode(plain);
}
