import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "msedge",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#heart-3d", { timeout: 25000 });
await page.waitForTimeout(1500);

// Select Kabir Singh (LAD 70%)
console.log("Selecting Kabir Singh...");
await page.locator("#patient-DEMO07").click();
await page.waitForTimeout(3000);

// Screenshot overview of Kabir Singh's heart
const heartCard = page.locator("#card-heart");
await heartCard.screenshot({ path: "shots/kabir_heart_overview.png" });

// Switch camera to Focus LAD (Anterior)
console.log("Switching to Focus LAD view...");
await page.locator("#view-LAD").click();
await page.waitForTimeout(2500);
await heartCard.screenshot({ path: "shots/kabir_heart_lad_focus.png" });

// Enable X-Ray mode to inspect the coronary tree and constriction
console.log("Enabling X-Ray Mode...");
await page.locator("#xray-toggle").click();
await page.waitForTimeout(2000);
await heartCard.screenshot({ path: "shots/kabir_heart_xray.png" });

await browser.close();
console.log("Screenshots saved successfully.");
