// Smoke tests for Monarch Compass. Run: npm test
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = rel => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const progress = read("./fixtures/progress.json");
const { milestones } = read("../data/milestones.json");
const KEY = "slc-tracker-v1";
const DONE = Object.keys(progress.m).length; // 15
const TOTAL = milestones.length;               // 35

// The engine decides the next step; the test asks it the same question the page does.
await import("../js/engine.js");
const E = globalThis.MonarchEngine;
const MS = milestones.map(m => ({ id: m.id, ph: m.phase, req: m.requires, tags: m.tags, line: m.line }));
const title = id => milestones.find(m => m.id === id).title;

test.beforeEach(async ({ page }, info) => {
  info.pageErrors = [];
  page.on("pageerror", e => info.pageErrors.push(e.message));
});
test.afterEach(async ({}, info) => {
  expect(info.pageErrors, "uncaught page errors").toEqual([]);
});

async function seed(page, data = progress) {
  await page.addInitScript(([key, d]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(d)); }, [KEY, data]);
}
const tick = (page, sel) => page.locator(sel).evaluate(el => { el.checked = !el.checked; el.dispatchEvent(new Event("change", { bubbles: true })); });

test("fresh visit renders every milestone with nothing ticked", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle("Solo Leveling: ARISE Guide, Stat Planner and Route | Monarch Compass");
  await expect(page.locator("h1")).toHaveText("Solo Leveling: ARISEMonarch Compass");
  await expect(page.locator("#s-ms")).toHaveText(`0/${TOTAL}`);
  await expect(page.locator("#phases li[data-m]")).toHaveCount(TOTAL);
  await expect(page.locator("#next h3")).toContainText("Clear Story Chapter 1");
  await expect(page.locator('#phases li[data-st="ready"]')).toHaveCount(1);
});

test("saved progress renders the counts and the solver's next step", async ({ page }) => {
  await seed(page);
  await page.goto("./");
  await expect(page.locator("#s-ms")).toHaveText(`${DONE}/${TOTAL}`);
  await expect(page.locator('#phases li[data-st="done"]')).toHaveCount(DONE);
  const next = E.route(MS, progress.m, "f2p")[0].id;
  await expect(page.locator("#next h3")).toContainText(title(next));
  await expect(page.locator("#s-tier")).toHaveText("Under 2M");

  // Switching plan re-scores the route.
  await page.locator('#prof button[data-p="spender"]').click();
  await expect(page.locator("#next h3")).toContainText(title(E.route(MS, progress.m, "spender")[0].id));
});

test("Mark done ticks the milestone, moves on and survives a reload", async ({ page }) => {
  await seed(page);
  await page.goto("./");
  const first = E.route(MS, progress.m, "f2p")[0].id;
  await page.locator("#next [data-done]").click();
  await expect(page.locator("#s-ms")).toHaveText(`${DONE + 1}/${TOTAL}`);
  const second = E.route(MS, { ...progress.m, [first]: true }, "f2p")[0].id;
  await expect(page.locator("#next h3")).toContainText(title(second));
  await page.reload();
  await expect(page.locator("#s-ms")).toHaveText(`${DONE + 1}/${TOTAL}`);
  await expect(page.locator(`li[data-m="${first}"]`)).toHaveAttribute("data-st", "done");
});

test("stat planner: guide rules by default, damage model with per-point gains", async ({ page }) => {
  await page.goto("./#stats");
  await expect(page.locator("#p-stats")).toBeVisible();
  await page.locator("#st-pts").fill("100");
  await page.locator("#st-ct").selectOption("story");
  await expect(page.locator("#st-out .bar").first()).toContainText("STR");
  await expect(page.locator("#st-out .bar").first().locator("b")).toHaveText("100");
  await expect(page.locator("#st-out .conf")).toHaveText("guide");

  await page.locator("#st-ct").selectOption("boss");
  await page.locator("#st-prec").fill("80");
  await page.locator("#st-gp").fill("0.5");
  await expect(page.locator("#st-out ol")).toContainText("Put 20 into Perception. Precision should reach 90%.");

  for (const [id, v] of [["atk", "20000"], ["cr", "50"], ["cd", "150"], ["gs", "12"], ["ga", "0.4"]]) await page.locator("#st-" + id).fill(v);
  await expect(page.locator("#st-out .conf")).toHaveText("estimate");
  await expect(page.locator("#st-out ol")).toContainText("Expected damage: +");
});

test("draw calculator uses the official Draw Support numbers", async ({ page }) => {
  await page.goto("./#draws");
  await expect(page.locator("#dr-w-f")).toBeHidden();
  await page.locator("#dr-t").fill("0");
  await page.locator("#dr-es").fill("0");
  await expect(page.locator("#dr-out .big div").nth(1).locator("b")).toHaveText("67");
  await expect(page.locator("#dr-out .big div").nth(3).locator("b")).toHaveText("140");
  await page.locator("#dr-p").fill("65");
  await page.locator("#dr-g").check();
  await expect(page.locator("#dr-out .big div").nth(3).locator("b")).toHaveText("5");
  await page.locator("#dr-t").fill("5");
  await expect(page.locator("#dr-out .big div").first().locator("b")).toHaveText("100%");

  await page.locator("#dr-b").selectOption("custom");
  await expect(page.locator("#dr-w-f")).toBeVisible();
  await page.locator("#dr-g").uncheck();
  await page.locator("#dr-p").fill("0");
  await expect(page.locator("#dr-out .big div").nth(3).locator("b")).toHaveText("none");
});

test("pack calculator ranks packs by draws per unit of money", async ({ page }) => {
  await page.goto("./#draws");
  await expect(page.locator("#packs tbody tr")).toHaveCount(1);
  await page.locator("#pk-add").click();
  const row = page.locator("#packs tbody tr").nth(1);
  await row.locator('input[data-k="n"]').fill("Stone bundle");
  await row.locator('input[data-k="price"]').fill("4.99");
  await row.locator('input[data-k="es"]').fill("2500");
  await row.locator('input[data-k="es"]').blur();
  await expect(row.locator("td.n").first()).toHaveText("10.0");
  await expect(row.locator(".pill")).toHaveText("best");
});

test("daily list shows only unlocked content and clears at the daily reset", async ({ page }) => {
  await seed(page, { ...progress, dk: "", wk: "" });
  await page.goto("./#daily");
  await expect(page.locator('#dl-d [data-dt="d:gates"]')).toBeVisible();
  await expect(page.locator('#dl-d [data-dt="d:wobl"]')).toHaveCount(0); // needs Chapter 25
  await expect(page.locator('#dl-s [data-dt="s:bot"]')).toBeChecked();  // seasonal ticks persist
  await tick(page, '#dl-d [data-dt="d:gates"]');
  await page.reload();
  await expect(page.locator('#dl-d [data-dt="d:gates"]')).toBeChecked();

  // An old reset stamp means a new day: daily ticks clear, seasonal ones stay.
  await page.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)); s.dk = "2000-01-01"; localStorage.setItem(k, JSON.stringify(s)); }, KEY);
  await page.reload();
  await expect(page.locator('#dl-d [data-dt="d:gates"]')).not.toBeChecked();
  await expect(page.locator('#dl-s [data-dt="s:bot"]')).toBeChecked();

  await page.locator("#dl-lock").check();
  await expect(page.locator('#dl-d [data-dt="d:wobl"]')).toBeDisabled();
});

test("export downloads the progress in the saved format", async ({ page }) => {
  await seed(page);
  await page.goto("./");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#bk-exp").click()]);
  expect(dl.suggestedFilename()).toMatch(/^monarch-compass-progress-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync(await dl.path(), "utf8"));
  expect(data.v).toBe(1);
  expect(Object.keys(data.m).length).toBe(DONE);
  await expect(page.locator("#bk-msg")).toContainText(`Exported ${DONE} milestones`);
});

test("import restores progress, asks before replacing, and rejects other files", async ({ page }) => {
  await page.goto("./");
  const file = fileURLToPath(new URL("./fixtures/progress.json", import.meta.url));
  await page.locator("#bk-file").setInputFiles(file);
  await expect(page.locator("#s-ms")).toHaveText(`${DONE}/${TOTAL}`);

  await page.locator("#bk-file").setInputFiles(file);
  await expect(page.locator("#bk-ask")).toBeVisible();
  await page.locator("#bk-no").click();
  await expect(page.locator("#bk-msg")).toHaveText("Import cancelled. Nothing changed.");

  await page.locator("#bk-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"q":[1]}') });
  await expect(page.locator("#bk-msg")).toContainText("not a Monarch Compass backup");
});

test("every tab opens from the menu", async ({ page }) => {
  await page.goto("./");
  for (const t of ["stats", "draws", "daily", "build", "about", "path"]) {
    await page.locator(`.menu a[data-tab="${t}"]`).click();
    await expect(page.locator(`#p-${t}`)).toBeVisible();
    await expect(page.locator(`.menu a[data-tab="${t}"]`)).toHaveAttribute("aria-current", "page");
  }
  await page.locator('.menu a[data-tab="about"]').click();
  expect(await page.locator("#srclist li").count()).toBeGreaterThan(20);
});

test("no horizontal scroll on any tab", async ({ page }) => {
  await seed(page);
  for (const t of ["path", "stats", "draws", "daily", "build", "about"]) {
    await page.goto("./#" + t);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, t).toBeLessThanOrEqual(0);
  }
});

test("manifest and icons are installable", async ({ request }) => {
  const m = await (await request.get("manifest.webmanifest")).json();
  expect(m.short_name).toBe("Monarch Compass");
  for (const i of m.icons) expect((await request.get(i.src)).ok(), i.src).toBe(true);
});

test("works offline after the first visit", async ({ page, context }) => {
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator("#phases li[data-m]")).toHaveCount(TOTAL);
  await context.setOffline(false);
});

test("a new deploy shows the update toast and reloads on request", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator("#upd")).toBeHidden();
  await page.request.get("/__bump-sw");
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect(page.locator("#upd")).toBeVisible();
  await Promise.all([page.waitForEvent("load"), page.locator("#upd-go").click()]);
  await expect(page.locator("#upd")).toBeHidden();
});
