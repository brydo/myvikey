export async function verifyTurnstile(secret: string, token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length < 1 || token.length > 2048) return false;
  try {
    // remoteip is deliberately not sent: no IP addresses are handled.
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
