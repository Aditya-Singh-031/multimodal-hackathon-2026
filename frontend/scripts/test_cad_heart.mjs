// Verification test: Kabir Singh CAD vessel stenosis, lumen cross-section HUD, and unmount error check.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "msedge",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const consoleLogs = [];

page.on("console", (m) => {
  const text = m.text();
  consoleLogs.push(`[${m.type()}] ${text}`);
  if (m.type() === "error") {
    console.log(`>>> BROWSER CONSOLE ERROR: ${text}`);
    errors.push(text);
  }
});
page.on("pageerror", (e) => {
  console.log(`>>> BROWSER PAGE ERROR: ${e}`);
  errors.push(String(e));
});

console.log("Navigating to http://localhost:3000 ...");
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#card-heart", { timeout: 25000 });
await page.waitForSelector("#heart-3d", { timeout: 25000 });
await page.waitForTimeout(1500);

// Find Kabir Singh button
console.log("Selecting Kabir Singh (DEMO07)...");
const kabirBtn = page.locator("#patient-DEMO07");
await kabirBtn.waitFor({ state: "visible", timeout: 10000 });
await kabirBtn.click();
await page.waitForTimeout(2500);

// Check vessel pins
const ladPin = page.locator("#vessel-pin-LAD");
await ladPin.waitFor({ state: "attached", timeout: 10000 });
const ladStenosis = await ladPin.getAttribute("data-stenosis");
const ladStatus = await ladPin.getAttribute("data-status");
console.log(`LAD Pin: stenosis=${ladStenosis}%, status=${ladStatus}`);

// Click LAD chip or pin to open Inspection HUD
console.log("Opening LAD Lumen Inspection card...");
const ladChip = page.locator("#vessel-chip-LAD");
await ladChip.click();
await page.waitForTimeout(1500);

const inspector = page.locator("#vessel-inspector");
await inspector.waitFor({ state: "visible", timeout: 5000 });

const inspectorStenosis = await page.locator("#inspector-stenosis").textContent();
console.log(`Inspector Stenosis: ${inspectorStenosis}`);

const lumenCard = page.locator("#vessel-lumen-card");
const lumenCardVisible = await lumenCard.isVisible();
const lumenCardText = await lumenCard.textContent();
console.log(`Lumen Card Visible: ${lumenCardVisible}`);
console.log(`Lumen Card Summary: ${lumenCardText?.replace(/\s+/g, " ").trim()}`);

await page.screenshot({ path: "shots/kabir_singh_cad_modal.png", fullPage: true });

// Check 4 pins are all mounted
for (const id of ["LAD", "LCx", "RCA", "LM"]) {
  const pin = page.locator(`#vessel-pin-${id}`);
  const count = await pin.count();
  console.log(`Pin ${id} mounted count: ${count}`);
}

// Switch between patients to ensure zero unmount errors occur
console.log("Testing rapid patient switching for unmount stability...");
await page.locator("#patient-DEMO01").click();
await page.waitForTimeout(1000);
await page.locator("#patient-DEMO09").click();
await page.waitForTimeout(1000);
await page.locator("#patient-DEMO07").click();
await page.waitForTimeout(1500);

console.log("Total console errors encountered:", errors.length);
if (errors.length > 0) {
  console.error("Errors found:", errors);
} else {
  console.log("SUCCESS: Zero console errors, zero React 19 unmount race condition errors!");
}

await browser.close();
