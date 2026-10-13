import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
const views = (process.argv[2] ?? "0,0,4;0,0,-4;4,0,0;-4,0,0").split(";");
const out = process.argv[3] ?? "C:/Users/adity/.gemini/antigravity-ide/brain/0fad07c1-642d-4c98-b542-83a8a1639a69/scratch";
for (const [i, d] of views.entries()) {
  await page.goto(`http://localhost:3000/debug-heart?d=${d}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/probe_${i}.png` });
  console.log("shot", i, d);
}
await browser.close();
