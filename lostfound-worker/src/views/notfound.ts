import { esc, html } from "../lib/html.ts";

export function notFoundView(): Response {
  return html(
    "Not found",
    () => `<h1>Not found</h1><p>We couldn't find that page. If you found a lost pet or item, please check the tag link and try again.</p>`,
    404,
  );
}
