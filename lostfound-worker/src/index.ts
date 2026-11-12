import { handleReveal } from "./routes/reveal.ts";
import { handleManage } from "./routes/manage.ts";
import { handleClaim, handleTagGet } from "./routes/tag.ts";
import { ID_RE } from "./lib/validate.ts";
import { notFoundView } from "./views/notfound.ts";
import type { Env } from "./types.ts";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    const [area, id, a, b] = parts;

    if (!id || !ID_RE.test(id)) return notFoundView();

    if (area === "found") {
      if (parts.length === 2 && req.method === "GET") return handleTagGet(env, id);
      if (parts.length === 3 && req.method === "POST" && a === "claim") return handleClaim(req, env, id);
      if (parts.length === 3 && req.method === "POST" && a === "reveal") return handleReveal(req, env, id);
    }

    if (area === "manage" && a) {
      if (parts.length === 3 && req.method === "GET") return handleManage(req, env, id, a, undefined);
      if (parts.length === 4 && req.method === "POST") return handleManage(req, env, id, a, b);
    }

    return notFoundView();
  },
} satisfies ExportedHandler<Env>;
