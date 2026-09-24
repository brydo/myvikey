// GET /api/admin — admin actions for stock management
// Usage:
//   /api/admin?secret=xxx&action=reset              → reset ALL tags to 50
//   /api/admin?secret=xxx&action=setall&value=0     → set ALL tags to any number
//   /api/admin?secret=xxx&action=set&tag=tag1&value=50  → set one tag
//   /api/admin?secret=xxx                          → view current stock

const TAGS = ["tag1", "tag2", "tag3", "tag4", "tag5","tag6"];
const ADMIN_SECRET ="Qnwbevrctxyz123!"; // ← CHANGE THIS TO YOUR OWN SECRET!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const secret = url.searchParams.get("secret");
  if (secret !== ADMIN_SECRET) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const action = url.searchParams.get("action");

  // RESET ALL tags to 50
  if (action === "reset") {
    for (const tag of TAGS) {
      await env.STOCK_KV.put("stock:" + tag, "50");
    }
    return new Response(
      JSON.stringify({ success: true, message: "All tags reset to 50" }, null, 2),
      { headers: corsHeaders }
    );
  }

  // SET ALL tags to a specific value
  if (action === "setall" && url.searchParams.get("value") !== null) {
    const value = url.searchParams.get("value");
    for (const tag of TAGS) {
      await env.STOCK_KV.put("stock:" + tag, value);
    }
    return new Response(
      JSON.stringify({ success: true, message: "All tags set to " + value }, null, 2),
      { headers: corsHeaders }
    );
  }

  // SET a specific tag to a specific value
  if (action === "set" && url.searchParams.get("tag") && url.searchParams.get("value")) {
    const tag = url.searchParams.get("tag");
    const value = url.searchParams.get("value");
    if (TAGS.includes(tag)) {
      await env.STOCK_KV.put("stock:" + tag, value);
      return new Response(
        JSON.stringify({ success: true, message: tag + " set to " + value }, null, 2),
        { headers: corsHeaders }
      );
    }
  }

  // DEFAULT: return current stock levels
  const stock = {};
  for (const tag of TAGS) {
    const val = await env.STOCK_KV.get("stock:" + tag);
    const num = val ? parseInt(val) : 50;
    stock[tag] = isNaN(num) ? 50 : num;
  }
  return new Response(JSON.stringify(stock, null, 2), { headers: corsHeaders });
}
