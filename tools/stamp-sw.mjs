// Sets VERSION in sw.js to a hash of the app shell files, so every change to the shell
// ships a new service worker (and the "Update available" toast).
// Usage: node tools/stamp-sw.mjs            rewrite sw.js
//        node tools/stamp-sw.mjs --check    exit 1 if sw.js is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const swPath = join(root, "sw.js");
const sw = readFileSync(swPath, "utf8");

const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)]
  .map(m => m[1]).filter(u => u !== "./");
const hash = createHash("sha256");
for (const f of shell) hash.update(f).update(readFileSync(join(root, f)));
const version = hash.digest("hex").slice(0, 12);

const next = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
if (process.argv.includes("--check")) {
  if (next !== sw) { console.error(`sw.js VERSION is stale; run npm run build (expected ${version}).`); process.exit(1); }
  console.log(`sw.js VERSION ${version} is current.`);
} else {
  writeFileSync(swPath, next);
  console.log(`sw.js VERSION ${version}`);
}
