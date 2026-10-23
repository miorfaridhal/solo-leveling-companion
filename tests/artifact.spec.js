// Tests the claude.ai artifact build (build/artifact.html, made by tools/build-artifact.mjs)
// against a stand-in window.claude: account sync through db + user, export through downloads.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const progress = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/progress.json", import.meta.url)), "utf8"));
const PROGRESS = "data/users/viewer-1/progress";
const DONE = Object.keys(progress.m).length;

// A minimal window.claude with the same call shapes the page uses. `docs` seeds the store by path.
async function fakeClaude(page, { docs = {} } = {}) {
  await page.addInitScript(seed => {
    const store = { ...seed }, writes = [], saves = [];
    const snap = path => ({ id: path.split("/").pop(), exists: path in store, data: () => store[path] });
    const doc = path => ({
      get: () => Promise.resolve(snap(path)),
      onSnapshot(fn) { setTimeout(() => fn(snap(path)), 0); return () => {}; },
      set(data) { writes.push({ path, data }); store[path] = data; return Promise.resolve(); },
    });
    const api = {
      db: { doc },
      user: { id: () => Promise.resolve("viewer-1"), isOwner: () => Promise.resolve(true) },
      downloads: { save: req => { saves.push(req); return Promise.resolve({ status: "saved" }); } },
    };
    window.__fake = { writes, saves, store };
    window.claude = { use: name => new Promise(r => setTimeout(() => r(api[name] || null), 10)) };
  }, docs);
}
const writesTo = (page, path) => page.evaluate(p => window.__fake.writes.filter(w => w.path === p), path);

test.beforeEach(async ({ page }, info) => {
  info.pageErrors = [];
  page.on("pageerror", e => info.pageErrors.push(e.message));
});
test.afterEach(async ({}, info) => {
  expect(info.pageErrors, "uncaught page errors").toEqual([]);
});

test("artifact build is one self-contained page", async ({ page }) => {
  const html = readFileSync(fileURLToPath(new URL("../build/artifact.html", import.meta.url)), "utf8");
  expect(html.startsWith("<title>Monarch Compass</title>")).toBe(true);
  expect(html).toContain('name="claude:viewport-fit-sides"');
  expect(html).not.toMatch(/<script src=|serviceWorker|goatcounter|<html|<head>/i);
  await page.goto("build/artifact.html");
  await expect(page.locator("#phases li[data-m]")).toHaveCount(35);
});

test("artifact build loads account progress and saves ticks back to it", async ({ page }) => {
  await fakeClaude(page, { docs: { [PROGRESS]: progress } });
  await page.goto("build/artifact.html");
  await expect(page.locator("#save")).toHaveText("Saved to your account");
  await expect(page.locator("#s-ms")).toHaveText(`${DONE}/35`);
  await expect(page.locator("#bk-where")).toContainText("saved to your Claude account");
  await expect(page.locator("#upd")).toHaveCount(0);

  await page.locator("#next [data-done]").click();
  await expect(page.locator("#s-ms")).toHaveText(`${DONE + 1}/35`);
  await expect.poll(async () => (await writesTo(page, PROGRESS)).length).toBeGreaterThan(0);
  const last = (await writesTo(page, PROGRESS)).at(-1);
  expect(Object.keys(last.data.m).length).toBe(DONE + 1);
});

test("artifact build exports through the downloads capability", async ({ page }) => {
  await fakeClaude(page, { docs: { [PROGRESS]: progress } });
  await page.goto("build/artifact.html");
  await expect(page.locator("#s-ms")).toHaveText(`${DONE}/35`);
  await page.locator("#bk-exp").click();
  await expect(page.locator("#bk-msg")).toContainText(`Exported ${DONE} milestones`);
  const save = await page.evaluate(() => window.__fake.saves[0]);
  expect(save.filename).toMatch(/^monarch-compass-progress-\d{4}-\d{2}-\d{2}\.json$/);
  expect(Object.keys(JSON.parse(save.data).m).length).toBe(DONE);
});

test("artifact build with an empty account uploads the browser's progress", async ({ page }) => {
  await fakeClaude(page);
  await page.addInitScript(p => { if (!localStorage.getItem("slc-tracker-v1")) localStorage.setItem("slc-tracker-v1", JSON.stringify(p)); }, progress);
  await page.goto("build/artifact.html");
  await expect.poll(async () => (await writesTo(page, PROGRESS)).length).toBeGreaterThan(0);
  expect(Object.keys((await writesTo(page, PROGRESS))[0].data.m).length).toBe(DONE);
});
