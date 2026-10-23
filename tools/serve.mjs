// Local static server that mounts the site under /solo-leveling-companion/, the same path
// GitHub Pages uses, so relative paths and the service worker scope are tested for real.
// Usage: node tools/serve.mjs [port]      (default 4183, listens on 127.0.0.1 only)
// Test hook: GET /__bump-sw makes every later sw.js response differ, as a new deploy would.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = "/solo-leveling-companion/";
const port = +process.argv[2] || 4183;
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".md": "text/markdown; charset=utf-8", ".css": "text/css",
};
let bump = 0;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__bump-sw") { bump++; res.writeHead(204); return res.end(); }
  if (path === "/" || path === base.slice(0, -1)) { res.writeHead(302, { Location: base }); return res.end(); }
  if (!path.startsWith(base)) { res.writeHead(404); return res.end("not found"); }
  const rel = path.slice(base.length) || "index.html";
  const file = normalize(join(root, rel.endsWith("/") ? rel + "index.html" : rel));
  if (!file.startsWith(root + sep) || rel.startsWith("docs/") || rel.startsWith("node_modules/")) { res.writeHead(403); return res.end(); }
  try {
    let body = await readFile(file);
    if (rel === "sw.js" && bump) body = Buffer.concat([body, Buffer.from(`\n// bump ${bump}\n`)]);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Monarch Compass on http://127.0.0.1:${port}${base}`));
