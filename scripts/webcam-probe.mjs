/**
 * Opens the running mirror and asks for a real camera.
 * Does not enable a fake media device. Does not write a generated image.
 */
import { createRequire } from "node:module";

const require = createRequire("/workspace/package.json");
const { chromium } = require("playwright");

const url = process.env.MIRROR_URL || "http://127.0.0.1:8080/";
const executablePath =
  process.env.CHROME ||
  "/opt/pw-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-fake-ui-for-media-stream"],
});
const page = await browser.newPage();
const report = {
  url,
  fakeDevice: false,
  fakeUi: true,
  videoInputs: 0,
  opened: false,
  errorName: null,
  pageError: null,
  fps: null,
  faceHz: null,
  poseHz: null,
  handHz: null,
  segmentHz: null,
  compositeMs: null,
  cameraSession: null,
  productSwitchKeptSession: null,
  panel: "",
};
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "Use my camera" }).first().waitFor({ state: "visible", timeout: 20000 });
  const devices = await page.evaluate(async () => {
    const listed = await navigator.mediaDevices.enumerateDevices();
    const videos = listed.filter((device) => device.kind === "videoinput");
    let errorName = null;
    let opened = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      opened = stream.getVideoTracks().length > 0;
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      errorName = error && typeof error === "object" && "name" in error ? String(error.name) : "Error";
    }
    return { videos: videos.length, opened, errorName };
  });
  report.videoInputs = devices.videos;
  report.opened = devices.opened;
  report.errorName = devices.errorName;
  const buttons = page.getByRole("button", { name: "Use my camera" });
  await buttons.last().click({ timeout: 10000 });
  await page.waitForTimeout(1000);
  report.panel = await page.locator("body").innerText();
  if (report.panel.includes("No camera was found")) report.pageError = "No camera was found on this device.";
  else if (report.panel.includes("Camera permission was blocked")) report.pageError = "Camera permission was blocked.";
} catch (error) {
  if (!report.pageError) report.pageError = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
}
if (report.panel.length > 400) {
  const at = report.panel.indexOf("No camera");
  report.panel = at >= 0 ? report.panel.slice(Math.max(0, at - 60), at + 80) : report.panel.slice(0, 400);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
