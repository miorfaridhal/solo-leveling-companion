// Pulls the milestone, phase, routine and source tables out of index.html into data/*.json,
// so the solver, the tests and the page share one source of truth.
// Usage: node tools/extract.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// Grab `var NAME=<literal>;` where the literal is an array or object, balancing brackets and skipping strings.
function literal(name, ctx = {}) {
  const start = html.indexOf(`var ${name}=`);
  if (start < 0) throw new Error(`${name} not found in index.html`);
  let i = html.indexOf("=", start) + 1, depth = 0, str = null;
  const from = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (str) { if (c === "\\") i++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'") str = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return vm.runInNewContext("(" + html.slice(from, i) + ")", ctx);
}

const GUIDE = "https://guide.netmarble.com/sololv/";
const PH = literal("PH"), MS = literal("MS"), DY = literal("DY"), SOURCES = literal("SOURCES", { GUIDE });

const phases = PH.map(([id, title, about], i) => ({ id, order: i + 1, title, about }));
const milestones = MS.map(m => ({
  id: m.id, phase: m.ph, line: m.line, title: m.t, unlocks: m.un, requires: m.req || [], tags: m.tags || [],
  confidence: m.conf, todo: m.todo, warning: m.warn || "", f2p: m.f2p || "", spender: m.sp || "",
  sources: (m.src || []).map(id => GUIDE + id),
}));
const routine = DY.map(d => ({ id: d.id, every: { d: "day", w: "week", s: "season" }[d.e], title: d.t, how: d.h, unlockedBy: d.need || null }));
const sources = SOURCES.map(([title, url]) => ({ title, url }));

mkdirSync(join(root, "data"), { recursive: true });
const write = (f, v) => writeFileSync(join(root, "data", f), JSON.stringify(v, null, 2) + "\n");
write("milestones.json", { phases, milestones });
write("routine.json", routine);
write("sources.json", sources);
console.log(`data/: ${milestones.length} milestones in ${phases.length} phases, ${routine.length} routine items, ${sources.length} sources`);
