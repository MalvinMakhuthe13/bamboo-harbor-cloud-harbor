import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:8080";
const pass = process.argv[3] ?? "1";
const out = "/workspace/screenshots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: "/opt/google/chrome/chrome" });
const pieces = [
  ["Hair", "Honey bob"],
  ["Hair", "Espresso wave"],
  ["Hair", "Knotless braids"],
  ["Hats", "Felt fedora"],
  ["Hats", "Black cap"],
];

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(base + "/mirror", { waitUntil: "domcontentloaded" });
  const gate = page.locator(".absolute.inset-0");
  await gate.getByRole("button", { name: /studio photo/i }).click();
  await page.waitForTimeout(2500);
  for (const [category, product] of pieces) {
    await page.getByRole("button", { name: category, exact: true }).click();
    await page.getByRole("button", { name: product, exact: true }).click();
    await page.waitForTimeout(700);
    const slug = product.toLowerCase().replaceAll(" ", "-");
    await page.screenshot({ path: `${out}/pass${pass}-${viewport.name}-${slug}.png` });
  }
  const text = await page.locator("body").innerText();
  const fps = text.match(/(\d+)\s*fps/);
  console.log(`${viewport.name} fps ${fps ? fps[1] : "unread"} errors ${errors.length}`);
  await page.close();
}
await browser.close();
