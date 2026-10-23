// Unit tests for js/engine.js. Run: npm run test:unit
//
// 1. Draw Support follows the official rules (guide.netmarble.com/sololv/115): 1.2% base,
//    +5.8% per draw from the 60th, guaranteed by the 70th, 50/50 with a guarantee after a miss.
// 2. The stat planner keeps every point, follows the guide rules without per-point gains, and
//    with gains never chooses a stat that lowers the modelled damage.
// 3. The page's milestone order and every plan's route satisfy all requirements.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../../js/engine.js");
const E = globalThis.MonarchEngine;
const { milestones } = JSON.parse(readFileSync(new URL("../../data/milestones.json", import.meta.url), "utf8"));
const MS = milestones.map(m => ({ id: m.id, ph: m.phase, req: m.requires, tags: m.tags, line: m.line }));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("SSR rate per draw follows the official Draw Support table", () => {
  near(E.ssrRate(1), 0.012);
  near(E.ssrRate(59), 0.012);
  near(E.ssrRate(60), 0.07);
  near(E.ssrRate(69), 0.012 + 0.058 * 10);
  assert.equal(E.ssrRate(70), 1);
});

test("an SSR is certain by the 70th draw and the mean is about 44.8 draws", () => {
  let p = 1, mean = 0;
  for (let n = 1; n <= 70; n++) { mean += n * p * E.ssrRate(n); p *= 1 - E.ssrRate(n); }
  near(p, 0);
  assert.ok(mean > 44.5 && mean < 45.1, `mean ${mean}`);
  // 70 draws hold at least one SSR, and an early SSR can be followed by more.
  const ssrs = E.drawOdds({ banner: "rateup", copies: 1, draws: 70 }).ssrs;
  assert.ok(ssrs >= 1 && ssrs < 70 / 40, `expected SSRs ${ssrs}`);
});

test("Rate Up: featured hunter is certain within 140 draws, and within 70 when guaranteed", () => {
  near(E.drawOdds({ banner: "rateup", copies: 1, draws: 140 }).atLeast[1], 1, 1e-9);
  assert.ok(E.drawOdds({ banner: "rateup", copies: 1, draws: 139 }).atLeast[1] < 1);
  near(E.drawOdds({ banner: "rateup", copies: 1, draws: 70, guaranteed: true }).atLeast[1], 1, 1e-9);
  near(E.drawOdds({ banner: "rateup", copies: 1, draws: 5, pity: 65, guaranteed: true }).atLeast[1], 1, 1e-9);
  const r = E.drawsFor({ banner: "rateup", copies: 1 });
  assert.equal(r.ceiling, 140);
  assert.ok(r.mean >= 66 && r.mean <= 68, `mean ${r.mean}`); // 1.5 SSRs × 44.8
});

test("A5 (6 copies) on Rate Up has a hard ceiling of 840 draws", () => {
  assert.equal(E.drawsFor({ banner: "rateup", copies: 6 }).ceiling, 840);
  near(E.drawOdds({ banner: "rateup", copies: 6, draws: 840 }).atLeast[6], 1, 1e-9);
});

test("a specific pick on a Custom list has no hard ceiling and costs more than any pick", () => {
  const one = E.drawsFor({ banner: "custom", want: "one", copies: 1 }), any = E.drawsFor({ banner: "custom", want: "list", copies: 1 });
  assert.equal(one.ceiling, null);
  assert.equal(any.ceiling, 140);
  assert.ok(one.mean > any.mean * 2.5, `${one.mean} vs ${any.mean}`);
  const w = E.drawsFor({ banner: "weapon", want: "one", copies: 1 });
  assert.ok(w.mean > any.mean && w.mean < one.mean, `weapon ${w.mean}`);
});

test("probabilities only grow with more draws", () => {
  let last = 0;
  for (const n of [0, 10, 59, 60, 70, 100, 140, 300]) {
    const p = E.drawOdds({ banner: "weapon", want: "one", copies: 2, draws: n }).atLeast[2];
    assert.ok(p >= last - 1e-12, `${n}: ${p} < ${last}`);
    last = p;
  }
});

test("stat planner spends every point", () => {
  for (const content of ["story", "boss", "time"]) for (const pts of [0, 1, 37, 300]) {
    for (const extra of [{}, { survival: true, mana: true }, { readings: { atk: 9000, prec: 60, cr: 40, cd: 120 }, gains: { str: 9, per: 0.2, agi: 0.3 } }]) {
      const r = E.plan(Object.assign({ points: pts, content }, extra));
      const sum = E.STATS.reduce((a, k) => a + r.alloc[k], 0);
      assert.equal(sum, pts, `${content} ${pts} ${JSON.stringify(extra)}`);
    }
  }
});

test("guide rules: all Strength for story, Perception first for bosses below the target", () => {
  const story = E.plan({ points: 100, content: "story" });
  assert.equal(story.alloc.str, 100);
  assert.equal(story.confidence, "guide");
  const boss = E.plan({ points: 100, content: "boss", readings: { prec: 80 }, gains: { per: 0.5 } });
  assert.equal(boss.alloc.per, 20); // (90 − 80) / 0.5
  assert.equal(boss.alloc.str, 80);
  const reached = E.plan({ points: 100, content: "boss", readings: { prec: 95 } });
  assert.equal(reached.alloc.per, 0);
  const crit = E.plan({ points: 100, content: "story", readings: { cr: 70 } });
  assert.ok(crit.alloc.agi > 0 && crit.alloc.str > crit.alloc.agi);
});

test("damage model: each point goes where it adds the most, and the result never loses damage", () => {
  // Strength gives 1% per point, Perception 0.2 precision points (≈0.1%), so all Strength.
  const a = E.plan({ points: 50, content: "boss", readings: { atk: 1000, prec: 50, cr: 0, cd: 50 }, gains: { str: 10, per: 0.2, agi: 1 } });
  assert.equal(a.mode, "model");
  assert.equal(a.alloc.str, 50);
  assert.ok(a.gain > 0);
  // Perception very cheap relative to Strength: precision is filled to 100% first.
  const b = E.plan({ points: 60, content: "boss", readings: { atk: 100000, prec: 90, cr: 0, cd: 50 }, gains: { str: 1, per: 1, agi: 0 } });
  assert.equal(b.alloc.per, 10);
  assert.equal(b.alloc.str, 50);
  // Story content ignores Perception even when it is cheap.
  const c = E.plan({ points: 60, content: "story", readings: { atk: 100000, prec: 50, cr: 0, cd: 50 }, gains: { str: 1, per: 5, agi: 0 } });
  assert.equal(c.alloc.per, 0);
});

test("the page's milestone order and every plan's route are valid", () => {
  assert.deepEqual(E.check(MS, MS.map(m => m.id)), []);
  for (const p of ["f2p", "light", "spender"]) {
    const r = E.route(MS, {}, p);
    assert.equal(r.length, MS.length, p);
    assert.deepEqual(E.check(MS, r.map(s => s.id)), [], p);
  }
});

test("route continues from partial progress and only offers ready milestones", () => {
  const done = { ch1: true, ch2: true };
  const next = E.route(MS, done, "f2p")[0];
  const m = MS.find(x => x.id === next.id);
  assert.ok(m.req.every(r => done[r]), `${next.id} needs ${m.req}`);
  assert.ok(!done[next.id]);
});

test("check() reports broken orders", () => {
  const order = MS.map(m => m.id);
  const swapped = order.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.ok(E.check(MS, swapped).some(e => e.includes("before its requirement")));
  assert.ok(E.check(MS, order.slice(1)).some(e => e.includes("missing")));
});
