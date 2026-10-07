// Visual smoke test: node scripts/screenshot.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForSelector("#risk-gauge", { timeout: 20000 });
await page.waitForTimeout(2500);
console.log("badge:", (await page.textContent("#mode-badge"))?.trim());
console.log("gauge text:", (await page.textContent("#risk-gauge"))?.replace(/\s+/g, " ").trim());
console.log("canvas count:", await page.locator("#heart-3d canvas").count());
console.log("shap rows:", await page.locator("#shap-chart > div").count());
console.log("ecg svg:", await page.locator("#ecg-viewer svg").count());
await page.screenshot({ path: "shots/dashboard.png", fullPage: true });

const ids = await page.$$eval("[id^=patient-]", (els) => els.map((e) => e.id));
await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/predict") && r.status() === 200),
  page.click(`#${ids[0]}`)
]);
await page.waitForTimeout(1000);
console.log("first patient gauge:", (await page.textContent("#risk-gauge"))?.replace(/\s+/g, " ").trim());
await page.screenshot({ path: "shots/patient_low.png", fullPage: true });

await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/predict") && r.status() === 200),
  page.click(`#${ids[ids.length - 1]}`)
]);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /Smoker/ }).click();
await page.getByRole("button", { name: /Diabetic/ }).click();
await page.waitForTimeout(1500);
console.log("whatif:", (await page.textContent("#what-if"))?.replace(/\s+/g, " ").trim());
await page.screenshot({ path: "shots/whatif.png", fullPage: true });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
