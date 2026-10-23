// Builds the claude.ai artifact version of Monarch Compass from index.html.
//
// The artifact publisher wraps the page in its own <head>, so this keeps only the body and puts
// first the artifact's <title>, the side-gutter meta and the fonts and styles (the block between
// the artifact-head markers). It inlines js/engine.js, because an artifact is a single page, and
// drops the site-only block (service worker, update toast, GoatCounter), which cannot run inside
// an artifact. Everything else, including the account sync and the downloads-capability export,
// is the same code as the website.
//
// Usage: node tools/build-artifact.mjs      -> build/artifact.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TITLE = "Monarch Compass"; // gallery and tab name on claude.ai (a name, no colon explainer)

const src = readFileSync(join(root, "index.html"), "utf8");
const cut = (s, a, b, what) => {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error(`${what} markers not found in index.html`);
  return [i, j + b.length];
};

const [h0, h1] = cut(src, "<!-- artifact-head:start", "<!-- artifact-head:end -->", "artifact-head");
const head = src.slice(src.indexOf("-->", h0) + 3, h1 - "<!-- artifact-head:end -->".length).trim();

const body = src.indexOf("<body>");
if (body < 0) throw new Error("index.html has no <body>");
let html = src.slice(body + "<body>".length);

const [s0, s1] = cut(html, "<!-- site-only:start", "<!-- site-only:end -->", "site-only");
html = html.slice(0, s0) + html.slice(s1);

const engineTag = '<script src="js/engine.js"></script>';
if (!html.includes(engineTag)) throw new Error("engine script tag not found in index.html");
const engine = readFileSync(join(root, "js", "engine.js"), "utf8");
html = html.replace(engineTag, () => "<script>\n" + engine + "\n</script>");

html = html.replace(/\s*<\/body><\/html>\s*$/, "\n");
if (/serviceWorker|manifest\.webmanifest|goatcounter/i.test(html)) throw new Error("site-only code left in the artifact build");

const out = join(root, "build", "artifact.html");
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(out, `<title>${TITLE}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${head}\n${html.replace(/^\s+/, "")}`);
console.log(`build/artifact.html (${(Buffer.byteLength(readFileSync(out)) / 1024).toFixed(1)} KB)`);
