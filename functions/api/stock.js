// GET /api/stock — returns current stock levels for all tags
// KV binding "STOCK_KV" must be configured in Pages settings

const TAGS = ["tag1", "tag2", "tag3", "tag4", "tag5"];

export async function onRequestGet(context) {
  const { env } = context;
  const stock = {};
  for (const tag of TAGS) {
    const val = await env.STOCK_KV.get("stock:" + tag);
    stock[tag] = val ? parseInt(val) : 50;
  }
  return new Response(JSON.stringify(stock), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
