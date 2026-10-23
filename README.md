# Monarch Compass: Solo Leveling: ARISE Companion

<img src="icons/icon-192.png" alt="" width="96" align="right">

A fan-made companion for **Solo Leveling: ARISE**. It works from your own progress. It tells you where to put Sung Jinwoo's stat points, which unlock to chase next, how many draws you need for a hunter or weapon, and what to clear every day and week. It has separate advice for free-to-play players and for spenders.

**Open it:** https://miorfaridhal.github.io/solo-leveling-companion/ (after GitHub Pages is switched on for this repository)

- **Install it.** On Android Chrome use *Add to Home screen*; on iPhone Safari use *Share → Add to Home Screen*. It opens full screen like an app.
- **Works offline.** After the first visit the whole app is cached. When a new version is published, an *Update available* toast offers a one-tap reload.
- **Your progress stays yours.** Ticks and numbers are saved in your browser (localStorage) and never sent anywhere. *Export progress* saves a JSON file; *Import progress* on another device carries on there.

## What is in it

| Tab | What it does |
|---|---|
| Path | 35 milestones, from Chapter 1 to the Workshop of Brilliant Light and Expert story. Each one has its official unlock condition, what it opens, what to do first and any reward you can miss. A *Next quest* card picks the best one for your plan. A *Stuck?* checklist covers elements, team shape, respec and practice modes. |
| Stats | Stat point planner for Sung Jinwoo: Story, Boss or Time-attack plan, with guide rules by default or a damage model when you enter your own per-point numbers. |
| Draws | Draw Support calculator from the official rates (Rate Up, Custom, Weapon Custom; copies up to A5), F2P / light / spender spending plans, and a pack value calculator. |
| Daily | Daily, weekly and seasonal checklist limited to what you have unlocked. It resets itself at the daily and weekly reset. |
| Build | Team shapes, elements, Shadows, Skill Runes, Blessing Stones, artifacts, Cores, Gems, Armory and shop picks from the official guide. |

Every number and rule carries a label: **official** (the official ARISE guide on guide.netmarble.com, dated October 2026, or the in-game rate pages), **guide** (community consensus) or **estimate** (worked out by the app).

## Draw Support maths

[`js/engine.js`](js/engine.js) computes exact probabilities with a Markov chain over the Draw Support count, the "next one is guaranteed" flag and copies so far. The rules are from the official Draw Rate page:

- SSR rate 1.2% per draw; from the 60th draw since the last SSR it rises 5.8% per draw; an SSR is guaranteed by the 70th.
- Rate Up: 50% featured, and after a miss the next SSR is featured. Custom: 50% one of your 3 picks, then guaranteed on your list. Weapon Custom: the same with 2 picks.

Results: 44.8 draws per SSR on average, 67 per featured Rate Up hunter (140 at worst), 840 at worst for A5. One specific pick on a Custom list has no hard ceiling. The only reading we add is that the 60th draw is the first with the raise (7.0%).

## Stat planner

Official effects (Sung Jinwoo page): Strength raises basic Attack; Perception raises Precision and minimum damage; Agility raises Critical Hit Damage; Vitality raises HP and Defense; Intelligence raises MP.

- **Guide rules** (default): all Strength for Story and Gates. For bosses, Perception until Precision reaches the target (90%, 80% for time attack), then Strength. Agility takes a share only once crit rate from gear is 45% or more. Vitality and Intelligence only when you tick *I keep dying* or *I run out of MP*.
- **Damage model** (estimate), used once you enter Attack and what one point adds: damage ∝ Attack × (1 + Precision) / 2 × (1 + Crit Rate × Crit Damage). The planner gives each point to the stat with the largest gain.

## Route solver

[`solver/solve.mjs`](solver/solve.mjs) orders the milestones for each plan with the scorer in `js/engine.js`. Among milestones whose requirements are met, it picks the highest score:

| Signal | F2P | Light | Spender | Why |
|---|---:|---:|---:|---|
| daily | 60 | 60 | 60 | Opens a daily or weekly farm |
| power | 40 | 45 | 60 | Opens a Total Power system |
| currency | 35 | 25 | 10 | Gives Essence Stones or draw tickets |
| seasonal | 20 | 20 | 20 | Rewards from skipped seasons are gone |
| unlocks | 10 | 10 | 10 | Per milestone it leads to |
| early | 15 | 15 | 15 | Per phase before the last |
| chain | 3 | 3 | 3 | Same line as the last step |

```bash
node solver/solve.mjs
```

```bash
node solver/solve.mjs --check
```

The first writes [`data/route-solved.json`](data/route-solved.json) and [`ROUTE.md`](ROUTE.md). The second only checks the page's order and every plan's route, and exits non-zero on a violation.

### Limits

- Job Change timing is not published; Night Lord is placed after Chapter 9 and Monarch of Shadows after Night Lord.
- Battle Class 85 → The First Land comes from a June 2026 community guide and is marked **guide**.
- Weapon and hunter rankings change every patch, so the Build tab gives principles and the official picks, not a tier list.
- The daily reset hour is a setting (default 00:00 UTC). The weekly reset is taken as Thursday because Power of Calamity locks Wednesday 23:50–00:00 UTC for its weekly ranking.

## Data

The page (`index.html`) is the source of truth. `tools/extract.mjs` pulls its tables into `data/`:

| File | Contents |
|---|---|
| `data/milestones.json` | 5 phases and 35 milestones with requirements, unlocks, steps, warnings, confidence and source links |
| `data/routine.json` | Daily, weekly and seasonal routine with the milestone that unlocks each |
| `data/sources.json` | Every source cited on the About tab |
| `data/route-solved.json` | The solver's route for each plan with the reason for each step |

## Development

Static site: `index.html`, `js/engine.js`, `sw.js`, `manifest.webmanifest` and `icons/`, served from the `main` branch root by GitHub Pages. Node 18 or later for the tools and tests.

```bash
npm ci
```

```bash
npx playwright install chromium
```

```bash
npm run serve
```

```bash
npm test
```

```bash
npm run build
```

| Command | What it does |
|---|---|
| `npm run serve` | Serves the site at http://127.0.0.1:4183/solo-leveling-companion/, the same path as GitHub Pages. |
| `npm test` | Engine unit tests, then Playwright on a 390 px phone and a desktop: no page errors, milestone counts with a sample save, the next step matches the solver, stat planner, draw calculator (67 / 140 / 5), pack ranking, daily reset, export and import, no sideways scroll, offline, update toast, and the claude.ai build with a stand-in account. |
| `npm run build` | Re-extracts `data/`, re-runs the solver, stamps `sw.js` with a hash of the app shell and builds `build/artifact.html`. **Run it after any change to `index.html`, `js/` or `icons/`.** CI fails if you forget. |
| `npm run icons` | Re-renders the PNG icons from the SVGs. |

Progress is stored under the localStorage keys `slc-tracker-v1` (progress) and `slc-ui-v1` (view settings). Keep those names so saves keep loading.

## Sources

Unlock conditions, draw rules, stat effects, team shapes and shop picks are from the official ARISE guide at guide.netmarble.com (Fachtna's Essential ARISE Guide and the per-system pages, October 2026). Stat priorities and some F2P advice are from community guides (Game8, Driffle, the Netmarble forum). The full list with links is on the About tab.

## Disclaimer

Fan-made and unofficial. Solo Leveling: ARISE is a trademark of Netmarble and D&C Media. This project is not affiliated with or endorsed by them. The icon is an original drawing, not game artwork.

Code is MIT licensed (see [LICENSE](LICENSE)).
