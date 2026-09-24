// POST /api/order — decrements stock for selected tags
// Body: { "tags": ["tag1", "tag3"] }

const TAGS = ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const selectedTags = body.tags || [];
  const results = {};

  for (const tag of selectedTags) {
    if (!TAGS.includes(tag)) {
      results[tag] = "invalid tag";
      continue;
    }
    const current = await env.STOCK_KV.get("stock:" + tag);
    let currentNum = current !== null ? parseInt(current, 10) : 50;
    if (currentNum > 0) {
      currentNum--;
      await env.STOCK_KV.put("stock:" + tag, String(currentNum));
      results[tag] = currentNum;
    } else {
      results[tag] = "out of stock";
    }
  }

  return new Response(JSON.stringify({ success: true, results }), {
    headers: corsHeaders,
  });
}
