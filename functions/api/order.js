// POST /api/order — decrements stock for selected tags

const TAGS = ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const selectedTags = body.tags || [];

    if (!Array.isArray(selectedTags) || selectedTags.length === 0) {
      return new Response(JSON.stringify({ error: "No tags selected" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const results = {};
    for (const tag of selectedTags) {
      if (!TAGS.includes(tag)) continue;
      const current = parseInt((await env.STOCK_KV.get("stock:" + tag)) || "50");
      const realCurrent = isNaN(current) ? 50 : current;
      const newVal = Math.max(0, realCurrent - 1);
      await env.STOCK_KV.put("stock:" + tag, String(newVal));
      results[tag] = newVal;
    }

    return new Response(JSON.stringify({ success: true, stock: results }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}
