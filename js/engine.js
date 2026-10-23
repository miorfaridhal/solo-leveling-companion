// Monarch Compass engine: draw pity maths, the stat point planner and the route scorer.
//
// Plain script, no imports, so the page can load it with <script src> (and the claude.ai build
// can inline it) while Node tests and the solver load it with `await import()`. Everything is
// exposed on globalThis.MonarchEngine.
//
// Confidence of each part:
//   official  Draw Support rules from the in-game Draw Rate page (guide.netmarble.com/sololv/115):
//             base SSR rate 1.2%; from the 60th draw since the last SSR the rate rises 5.8% per
//             draw; an SSR is guaranteed by the 70th; on an SSR, 50% it is on your list (Rate Up:
//             the featured hunter; Custom: 1 of your 3 picks; Weapon Custom: 1 of your 2 picks);
//             after a miss the next SSR is on your list.
//   reading   Which draw first gets the +5.8% (we take the 60th draw at 1.2% + 5.8% = 7.0%) and
//             that "1/N of your list" means each pick is equally likely.
//   guide     Stat priorities (Strength first, Perception for precision, Agility once crit rate is
//             high, Vitality and Intelligence last) from community guides.
//   estimate  The damage model the stat planner uses when you enter per-point gains:
//             damage ∝ Attack × (1 + Precision) / 2 × (1 + CritRate × CritDamage).
(function (root) {
  "use strict";

  /* ---------------- draws ---------------- */
  var BASE = 0.012, SOFT = 60, STEP = 0.058, HARD = 70;

  // SSR chance on the n-th draw since the last SSR (n = 1..70).
  function ssrRate(n) {
    if (n >= HARD) return 1;
    if (n < SOFT) return BASE;
    return Math.min(1, BASE + STEP * (n - SOFT + 1));
  }

  var BANNERS = {
    rateup: { name: "Rate Up hunter", list: 1 },
    custom: { name: "Custom hunter (3 picks)", list: 3 },
    weapon: { name: "Weapon Custom (2 picks)", list: 2 },
  };

  // Probability distribution after `draws` draws.
  // opts: banner (rateup|custom|weapon), pity (draws already made since the last SSR, 0..69),
  //       guaranteed (true if the last SSR missed your list), draws, copies (target count),
  //       want: "one" = a specific SSR on your list, "list" = any SSR on your list.
  // Returns { atLeast: [P(≥0), P(≥1), ... P(≥copies)], ssrs: expected SSRs }.
  // `each(n, pTarget)` (optional) is called after every draw with P(≥copies) so far; return false to stop.
  function drawOdds(opts, each) {
    var b = BANNERS[opts.banner] || BANNERS.rateup;
    var K = Math.max(1, opts.copies | 0), N = Math.max(0, opts.draws | 0);
    var hit = opts.want === "list" || b.list === 1 ? 1 : 1 / b.list; // share of a list SSR you want
    // state index: pity (0..69) × guaranteed (0/1) × copies (0..K, K absorbs)
    var size = HARD * 2 * (K + 1), cur = new Float64Array(size), nxt;
    var idx = function (p, g, c) { return (p * 2 + g) * (K + 1) + c; };
    cur[idx(clampPity(opts.pity), opts.guaranteed ? 1 : 0, 0)] = 1;
    var ssrs = 0;
    for (var d = 0; d < N; d++) {
      nxt = new Float64Array(size);
      for (var p = 0; p < HARD; p++) for (var g = 0; g < 2; g++) for (var c = 0; c <= K; c++) {
        var m = cur[idx(p, g, c)];
        if (!m) continue;
        var r = ssrRate(p + 1);
        nxt[idx(Math.min(p + 1, HARD - 1), g, c)] += m * (1 - r);
        ssrs += m * r;
        var onList = g ? 1 : 0.5, want = onList * hit;
        nxt[idx(0, 0, Math.min(K, c + 1))] += m * r * want;         // the SSR you want
        nxt[idx(0, 0, c)] += m * r * onList * (1 - hit);            // on your list, not the one
        nxt[idx(0, 1, c)] += m * r * (1 - onList);                  // off-list: next one is on-list
      }
      cur = nxt;
      if (each) {
        var got = 0;
        for (var q = 0; q < HARD * 2; q++) got += cur[q * (K + 1) + K];
        if (each(d + 1, got) === false) break;
      }
    }
    var byCopies = new Array(K + 1).fill(0);
    for (var i = 0; i < size; i++) byCopies[i % (K + 1)] += cur[i];
    var atLeast = byCopies.map(function (_, k) { var s = 0; for (var j = k; j <= K; j++) s += byCopies[j]; return Math.min(1, s); });
    return { atLeast: atLeast, ssrs: ssrs };
  }

  // Draws needed for the target with 50% / 90% / 99% certainty, the mean, and the hard ceiling
  // (null when there is none, e.g. one specific pick on a Custom list can keep missing).
  function drawsFor(opts) {
    var b = BANNERS[opts.banner] || BANNERS.rateup, K = Math.max(1, opts.copies | 0);
    var specific = opts.want !== "list" && b.list > 1;
    var marks = { p50: null, p90: null, p99: null }, mean = 0, prev = 0, last = 0;
    drawOdds(Object.assign({}, opts, { draws: HARD * 2 * K * 8 + 200 }), function (n, p) {
      mean += (p - prev) * n; prev = p; last = n;
      if (marks.p50 === null && p >= 0.5) marks.p50 = n;
      if (marks.p90 === null && p >= 0.9) marks.p90 = n;
      if (marks.p99 === null && p >= 0.99) marks.p99 = n;
      return p < 0.999999;
    });
    mean += (1 - prev) * last; // tail beyond the cut-off
    var first = HARD - clampPity(opts.pity) + (opts.guaranteed ? 0 : HARD); // first copy, worst case
    return {
      p50: marks.p50, p90: marks.p90, p99: marks.p99, mean: Math.round(mean),
      ceiling: specific ? null : first + (K - 1) * HARD * 2,
    };
  }
  function clampPity(p) { p = p | 0; return p < 0 ? 0 : p > HARD - 1 ? HARD - 1 : p; }

  /* ---------------- stat planner ---------------- */
  var STATS = ["str", "vit", "agi", "int", "per"];
  var STAT_NAMES = { str: "Strength", vit: "Vitality", agi: "Agility", int: "Intelligence", per: "Perception" };

  // plan({ points, content, readings:{atk, prec, cr, cd}, gains:{str, per, agi}, precTarget,
  //        survival, mana })
  //   points      points to spend now (unspent, or all of them after a reset)
  //   content     "story" | "boss" | "time"  (mobs and gates, armoured or shielded bosses, time attack)
  //   readings    in-game numbers from the Sung Jinwoo stat screen: Attack, Precision %, Crit Rate %,
  //               Crit Damage % (all optional)
  //   gains       what ONE point adds, read from the allocation preview: Attack per Strength point,
  //               Precision % per Perception point, Crit Damage % per Agility point (optional)
  //   precTarget  Precision % to reach before Strength takes over (default 90 for bosses)
  //   survival    true if you keep dying (adds a small Vitality share)
  //   mana        true if you run out of MP (adds a small Intelligence share)
  // Returns { alloc, steps:[text], mode:"model"|"rules", confidence, gain }.
  function plan(o) {
    var pts = Math.max(0, Math.floor(+o.points || 0)), content = o.content || "story";
    var rd = o.readings || {}, gn = o.gains || {}, steps = [], alloc = { str: 0, vit: 0, agi: 0, int: 0, per: 0 };
    var target = +o.precTarget || (content === "boss" ? 90 : content === "time" ? 80 : 0);
    if (!pts) return { alloc: alloc, steps: ["No points to spend. Enter the number shown as available points on the Sung Jinwoo screen."], mode: "rules", confidence: "guide", gain: 0 };

    // Small fixed shares for survival and mana, only when asked for.
    var vit = o.survival ? Math.min(pts, Math.max(1, Math.round(pts * 0.1))) : 0;
    var intl = o.mana ? Math.min(pts - vit, Math.max(1, Math.round(pts * 0.05))) : 0;
    alloc.vit = vit; alloc.int = intl;
    var free = pts - vit - intl;
    if (vit) steps.push("Put " + vit + " into Vitality first. Only because you asked for survival; dodging with Extreme Evasion usually does more than Vitality.");
    if (intl) steps.push("Put " + intl + " into Intelligence for MP. Earrings (MP main stat) and MP Consumption Reduction gems do this better.");

    var useModel = +rd.atk > 0 && +gn.str > 0 && (+gn.per > 0 || +gn.agi > 0);
    if (useModel) {
      var atk = +rd.atk, prec = clamp01((+rd.prec || 0) / 100), cr = clamp01((+rd.cr || 0) / 100), cd = Math.max(0, (+rd.cd || 0) / 100);
      var dS = +gn.str, dP = (+gn.per || 0) / 100, dA = (+gn.agi || 0) / 100;
      var start = dmg(atk, prec, cr, cd), precCap = content === "story" ? 0 : 1;
      for (var i = 0; i < free; i++) {
        var base = dmg(atk, prec, cr, cd);
        var gS = dmg(atk + dS, prec, cr, cd) / base - 1;
        var gP = precCap && dP > 0 && prec < 1 ? dmg(atk, Math.min(1, prec + dP), cr, cd) / base - 1 : -1;
        var gA = dA > 0 && cr > 0 ? dmg(atk, prec, cr, cd + dA) / base - 1 : -1;
        if (gP >= gS && gP >= gA) { alloc.per++; prec = Math.min(1, prec + dP); }
        else if (gA > gS) { alloc.agi++; cd += dA; }
        else { alloc.str++; atk += dS; }
      }
      var gain = dmg(atk, prec, cr, cd) / start - 1;
      if (alloc.per) steps.push("Put " + alloc.per + " into Perception. Precision should read about " + Math.round(prec * 100) + "%.");
      if (alloc.agi) steps.push("Put " + alloc.agi + " into Agility. Crit Damage should read about " + Math.round(cd * 100) + "%.");
      if (alloc.str) steps.push("Put " + alloc.str + " into Strength. Attack should read about " + Math.round(atk).toLocaleString("en-US") + ".");
      if (content === "story") steps.push("Story and Gate mobs die before precision matters, so the planner ignores Perception here. Switch to Boss for armoured or shielded bosses.");
      steps.push("Expected damage: +" + (gain * 100).toFixed(1) + "% over now (estimate from the damage model).");
      return { alloc: alloc, steps: steps, mode: "model", confidence: "estimate", gain: gain };
    }

    // Rules mode (guide): Strength first; Perception up to the precision target for bosses;
    // Agility only once crit rate from gear is high.
    var prec0 = +rd.prec, cr0 = +rd.cr;
    var needPer = content !== "story" && target > 0 && !(prec0 >= target);
    var agiShare = cr0 >= 60 ? 0.3 : cr0 >= 45 ? 0.15 : 0;
    if (needPer) {
      var perPts = isFinite(prec0) && prec0 > 0 && +gn.per > 0 ? Math.min(free, Math.ceil((target - prec0) / +gn.per)) : Math.round(free * 0.4);
      alloc.per = perPts; free -= perPts;
      steps.push(+gn.per > 0
        ? "Put " + perPts + " into Perception. Precision should reach " + target + "%."
        : "Put up to " + perPts + " into Perception, 10 at a time, and stop as soon as Precision reads " + target + "% on the stat screen. Put whatever is left into Strength.");
    }
    if (agiShare && free > 0) {
      var a = Math.round(free * agiShare); alloc.agi = a; free -= a;
      steps.push("Put " + a + " into Agility. Your crit rate is " + cr0 + "%, so extra crit damage pays off.");
    }
    alloc.str += free;
    if (free) steps.push("Put " + free + " into Strength. It raises Attack, which every hit uses.");
    if (content === "story") steps.push("For Story, Gates and farming, Strength is all you need. Reset to the Boss plan before hard boss fights; a reset costs a little Gold.");
    return { alloc: alloc, steps: steps, mode: "rules", confidence: "guide", gain: null };
  }
  function dmg(atk, prec, cr, cd) { return atk * (1 + prec) / 2 * (1 + Math.min(1, cr) * cd); }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  /* ---------------- route scoring ---------------- */
  // Weights for choosing the next milestone among those whose requirements are met.
  var WEIGHTS = {
    daily: { f2p: 60, light: 60, spender: 60, why: "Opens a daily or weekly farm; it pays off every day after." },
    power: { f2p: 40, light: 45, spender: 60, why: "Opens a Total Power system." },
    currency: { f2p: 35, light: 25, spender: 10, why: "Gives Essence Stones or draw tickets." },
    seasonal: { f2p: 20, light: 20, spender: 20, why: "Seasonal; rewards from seasons you skip are gone." },
    unlocks: { f2p: 10, light: 10, spender: 10, why: "For each milestone it leads to." },
    early: { f2p: 15, light: 15, spender: 15, why: "Belongs to an earlier phase; earlier phases come first (per phase before the last)." },
    chain: { f2p: 3, light: 3, spender: 3, why: "Continues the same line (story, Hard, Expert, Workshop)." },
  };

  // Phase ids are "p1".."p5"; a milestone without one counts as the last phase.
  function phaseNo(m) { return +String(m.ph || "").replace(/\D/g, "") || 0; }
  function lastPhase(ms) { return ms.reduce(function (a, m) { return Math.max(a, phaseNo(m)); }, 0); }
  function available(ms, done) {
    return ms.filter(function (m) { return !done[m.id] && (m.req || []).every(function (r) { return done[r]; }); });
  }
  function score(m, ms, done, profile, last) {
    var w = function (k) { return WEIGHTS[k][profile] || WEIGHTS[k].f2p; }, s = 0, why = [];
    (m.tags || []).forEach(function (t) { if (WEIGHTS[t]) { s += w(t); why.push(t); } });
    var opens = ms.filter(function (x) { return !done[x.id] && (x.req || []).indexOf(m.id) >= 0; }).length;
    if (opens) { s += opens * w("unlocks"); why.push(opens + " next"); }
    var behind = lastPhase(ms) - phaseNo(m);
    if (behind > 0) { s += behind * w("early"); why.push("early"); }
    if (last && m.line && last.line === m.line) { s += w("chain"); }
    return { score: s, why: why };
  }
  // Greedy best-first route from `done` (an object of finished ids) for a profile.
  function route(ms, done, profile) {
    done = Object.assign({}, done || {}); profile = profile || "f2p";
    var out = [], last = null, guard = ms.length + 1;
    while (guard--) {
      var av = available(ms, done);
      if (!av.length) break;
      var best = null;
      av.forEach(function (m) {
        var s = score(m, ms, done, profile, last);
        // ties: keep data order, which follows the story
        if (!best || s.score > best.s.score) best = { m: m, s: s };
      });
      out.push({ id: best.m.id, score: best.s.score, why: best.s.why });
      done[best.m.id] = true; last = best.m;
    }
    return out;
  }
  // Checks an order against the requirements; returns a list of problems (empty = valid).
  function check(ms, order) {
    var seen = {}, byId = {}, errs = [];
    ms.forEach(function (m) { byId[m.id] = m; });
    order.forEach(function (id) {
      var m = byId[id];
      if (!m) { errs.push(id + " is not a milestone"); return; }
      if (seen[id]) errs.push(id + " appears twice");
      (m.req || []).forEach(function (r) { if (!seen[r]) errs.push(id + " comes before its requirement " + r); });
      seen[id] = true;
    });
    ms.forEach(function (m) { if (!seen[m.id]) errs.push(m.id + " is missing from the order"); });
    return errs;
  }

  root.MonarchEngine = {
    ssrRate: ssrRate, drawOdds: drawOdds, drawsFor: drawsFor, BANNERS: BANNERS, PITY: { base: BASE, soft: SOFT, step: STEP, hard: HARD },
    plan: plan, STATS: STATS, STAT_NAMES: STAT_NAMES,
    route: route, available: available, score: score, check: check, WEIGHTS: WEIGHTS,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
