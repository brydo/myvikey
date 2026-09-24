// GET /api/stock — returns current stock levels for all tags
// KV binding "STOCK_KV" must be configured in Pages settings

const TAGS = ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6"];

export async function onRequestGet(context) {
  const { env } = context;
  const stock = {};
  for (const tag of TAGS) {
    const val = await env.STOCK_KV.get("stock:" + tag);
    stock[tag] = val !== null ? parseInt(val, 10) : 50;
  }
  return new Response(JSON.stringify(stock), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });
}
