// Admin actions for stock management.
// Requires X-Admin-Session; credentials are never sent in URLs.

import { validateSession } from '../lib/auth.js';

const TAGS = ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://vi-key.uk",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!await validateSession(env, request.headers.get("x-admin-session"))) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const url = new URL(request.url);

  const action = url.searchParams.get("action");
  const parseStockValue = (value) => {
    if (!/^[0-9]{1,6}$/.test(value || "")) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100000 ? parsed : null;
  };

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
    const parsed = parseStockValue(value);
    if (parsed === null) {
      return new Response(JSON.stringify({ success: false, error: "Invalid stock value" }), { status: 400, headers: corsHeaders });
    }
    for (const tag of TAGS) {
      await env.STOCK_KV.put("stock:" + tag, String(parsed));
    }
    return new Response(
      JSON.stringify({ success: true, message: `All tags set to ${value}` }, null, 2),
      { headers: corsHeaders }
    );
  }

  // SET ONE tag to a specific value
  if (action === "set" && url.searchParams.get("tag") && url.searchParams.get("value") !== null) {
    const tag = url.searchParams.get("tag");
    const value = url.searchParams.get("value");
    if (!TAGS.includes(tag)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid tag" }), { status: 400, headers: corsHeaders });
    }
    const parsed = parseStockValue(value);
    if (parsed === null) {
      return new Response(JSON.stringify({ success: false, error: "Invalid stock value" }), { status: 400, headers: corsHeaders });
    }
    await env.STOCK_KV.put("stock:" + tag, String(parsed));
    return new Response(
      JSON.stringify({ success: true, message: `${tag} set to ${value}` }, null, 2),
      { headers: corsHeaders }
    );
  }

  // VIEW current stock (no action)
  const stock = {};
  for (const tag of TAGS) {
    stock[tag] = await env.STOCK_KV.get("stock:" + tag);
  }
  return new Response(JSON.stringify(stock, null, 2), { headers: corsHeaders });
}
