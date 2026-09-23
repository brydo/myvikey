// GET /api/stock — returns current stock levels for all tags

const TAGS = ["tag1", "tag2", "tag3", "tag4", "tag5"];

export async function onRequestGet(context) {
  const { env } = context;
  const stock = {};
  for (const tag of TAGS) {
    const val = await env.STOCK_KV.get("stock:" + tag);
    const num = val ? parseInt(val) : 50;
    stock[tag] = isNaN(num) ? 50 : num;
  }
  return new Response(JSON.stringify(stock), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
