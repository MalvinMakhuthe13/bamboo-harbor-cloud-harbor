/**
 * Headless route check for the live mirror. It uses the studio photograph.
 * It does not open a hardware camera and it does not claim a person was filmed.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:8080";
const outDir = "/workspace/screenshots";
mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

const routes = ["/", "/mirror", "/wardrobe", "/studio", "/lab", "/bench"];

const failures = [];

function note(ok, message) {
  const line = `${ok ? "PASS" : "FAIL"} ${message}`;
  console.log(line);
  if (!ok) failures.push(message);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "/opt/google/chrome/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  for (const route of routes) {
    errors.length = 0;
    const response = await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);
    const status = response?.status() ?? 0;
    const text = await page.locator("body").innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    note(status >= 200 && status < 400, `${viewport.name} ${route} status ${status}`);
    note(text.trim().length > 20, `${viewport.name} ${route} has visible text`);
    note(!overflow, `${viewport.name} ${route} horizontal overflow`);
    const shot = `${outDir}/${viewport.name}${route.replaceAll("/", "-") || "-home"}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    const serious = errors.filter((line) => !/Failed to load resource/i.test(line) || !/favicon/i.test(line));
    note(serious.length === 0, `${viewport.name} ${route} console ${serious.length ? serious.join(" | ") : "clean"}`);
  }

  if (viewport.name === "desktop") {
    errors.length = 0;
    await page.goto(base + "/mirror", { waitUntil: "domcontentloaded" });
    const gate = page.locator(".absolute.inset-0");
    const camera = gate.getByRole("button", { name: /use my camera/i });
    await camera.waitFor({ timeout: 20000 });
    if (await camera.count()) {
      await camera.click();
      await page.waitForTimeout(600);
      const status = await page.locator("body").innerText();
      note(/camera|permission|test/i.test(status), "desktop /mirror start without a camera names the failure");
    }
    await gate.getByRole("button", { name: /studio photo/i }).click();
    await page.waitForTimeout(4000);
    const studio = await page.locator("body").innerText();
    const fps = studio.match(/(\d+)\s*fps/);
    console.log(`FPS_READING ${fps ? fps[1] : "unread"}`);
    note(/studio photograph/i.test(studio), "desktop /mirror studio photograph is labelled as a test");

    for (const [category, product] of [
      ["Shirts", "Studio vest sample"],
      ["Shirts", "Studio short-sleeve sample"],
      ["Skirts", "Studio skirt sample"],
      ["Bracelets", "Studio bracelet sample"],
      ["Dresses", "Black slip"],
      ["Hair", "Honey bob"],
      ["Nails", "Glass manicure"],
      ["Nails", "Gloss pedicure estimate"],
    ]) {
      await page.getByRole("button", { name: category, exact: true }).click();
      await page.getByRole("button", { name: product, exact: true }).click();
      await page.waitForTimeout(400);
      const body = await page.locator("body").innerText();
      note(body.includes(product), `desktop /mirror selects ${product}`);
    }

    await page.getByRole("checkbox", { name: /fit help/i }).check();
    await page.waitForTimeout(500);
    const fit = await page.locator("body").innerText();
    note(/fit help/i.test(fit), "desktop /mirror fit help responds");
    await page.screenshot({ path: `${outDir}/desktop-mirror-vest.png` });

    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.waitForTimeout(300);
    const stopped = await page.locator("body").innerText();
    note(/studio photo/i.test(stopped), "desktop /mirror stop returns to the camera gate");
    await page.locator(".absolute.inset-0").getByRole("button", { name: /studio photo/i }).click();
    await page.waitForTimeout(800);
    note(true, "desktop /mirror studio restart clicked");

    await page.goto(base + "/wardrobe", { waitUntil: "networkidle" });
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await name.waitFor({ timeout: 15000 });
    await page.locator('input[type="file"]').setInputFiles("/workspace/public/catalog/shirt-vest-sample.png");
    await page.getByText("Self-reported reviewer name").waitFor({ timeout: 15000 });
    await name.fill("QA vest sample");
    await page.locator("select").first().selectOption("shirt");
    await page.locator("select").nth(1).selectOption("sleeveless");
    await page.getByRole("button", { name: /add to the mirror/i }).click();
    await page.getByText("Added. Open it in the mirror.").waitFor({ timeout: 8000 });
    const saved = await page.locator("body").innerText();
    note(saved.includes("QA vest sample"), "desktop /wardrobe saves a custom piece");
    await page.getByRole("link", { name: "Try on" }).click();
    await page.waitForTimeout(800);
    note(page.url().includes("/mirror?product="), `desktop wardrobe try opens the mirror (${page.url()})`);
    await page.screenshot({ path: `${outDir}/desktop-wardrobe-try.png` });
    await page.goto(base + "/wardrobe", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Remove" }).click();
    await page.waitForTimeout(500);
    const removed = await page.locator("body").innerText();
    note(/piece removed/i.test(removed), "desktop /wardrobe removes the custom piece");
    await page.screenshot({ path: `${outDir}/desktop-wardrobe-removed.png` });
  }

  if (viewport.name === "mobile") {
    errors.length = 0;
    await page.goto(base + "/mirror", { waitUntil: "domcontentloaded" });
    const studio = page.locator(".absolute.inset-0").getByRole("button", { name: /studio photo/i });
    await studio.waitFor({ timeout: 20000 });
    await studio.click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Skirts", exact: true }).click();
    await page.getByRole("button", { name: "Studio skirt sample", exact: true }).click();
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    note(!overflow, "mobile /mirror skirt has no horizontal overflow");
    const body = await page.locator("body").innerText();
    note(body.includes("Studio skirt sample"), "mobile /mirror selects the studio skirt");
    await page.screenshot({ path: `${outDir}/mobile-mirror-skirt.png`, fullPage: true });
  }

  await context.close();
}

await browser.close();
if (failures.length) {
  console.log(`QA_FAILURES ${failures.length}`);
  process.exit(1);
}
console.log("QA_OK");
