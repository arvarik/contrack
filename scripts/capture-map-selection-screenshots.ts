import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { ContrackInstance } from "../tests/e2e/fixtures/instance";
import { seedInstance } from "../tests/e2e/fixtures/seed";

async function run() {
  const outputDir = path.resolve(
    process.cwd(),
    "docs/screenshots/map-selection",
  );
  await fs.mkdir(outputDir, { recursive: true });

  const instance = await ContrackInstance.start({ authRequired: false });
  await seedInstance(instance);

  const browser = await chromium.launch();

  try {
    // 1. Capture Hover Card (Light and Dark)
    for (const theme of ["light", "dark"] as const) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        colorScheme: theme,
      });

      await page.goto(`${instance.baseURL}/map`);
      await page.waitForLoadState("networkidle");

      const map = page.getByRole("region", { name: "Contact map" });
      await map.waitFor({ state: "visible" });

      const adaPin = map.getByRole("button", {
        name: "Ada Lovelace, Babbage & Co",
      });
      await adaPin.waitFor({ state: "visible" });

      // Wait a moment for basemap tiles to render
      await page.waitForTimeout(3000);

      // Focus and press Space to pin the hover card
      await adaPin.focus();
      await page.keyboard.press("Space");

      const dialog = page.getByRole("dialog", { name: "Ada Lovelace" });
      await dialog.waitFor({ state: "visible" });
      await page.waitForTimeout(500);

      await page.screenshot({
        path: path.join(outputDir, `card-desktop-${theme}.png`),
      });

      await page.close();
    }

    // 2. Capture Selection (Light and Dark)
    for (const theme of ["light", "dark"] as const) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        colorScheme: theme,
      });

      await page.goto(`${instance.baseURL}/map`);
      await page.waitForLoadState("networkidle");

      const map = page.getByRole("region", { name: "Contact map" });
      await map.waitFor({ state: "visible" });

      // Wait a moment for tiles
      await page.waitForTimeout(3000);

      // Zoom into Virginia cluster
      const cluster3 = page.getByRole("button", {
        name: "3 contacts, 0 at risk, zoom in",
      });
      await cluster3.click();

      const cluster2 = page.getByRole("button", {
        name: "2 contacts, 0 at risk, zoom in",
      });
      await cluster2.waitFor({ state: "visible" });
      await cluster2.click();

      const gracePin = map.getByRole("button", { name: /Grace Hopper/ });
      const katherinePin = map.getByRole("button", {
        name: /Katherine Johnson/,
      });
      await gracePin.waitFor({ state: "visible" });
      await katherinePin.waitFor({ state: "visible" });
      await page.waitForTimeout(1000);

      const graceBox = await gracePin.boundingBox();
      const katherineBox = await katherinePin.boundingBox();

      if (graceBox && katherineBox) {
        const startX = Math.min(graceBox.x, katherineBox.x) - 25;
        const startY = Math.min(graceBox.y, katherineBox.y) - 25;
        const endX =
          Math.max(
            graceBox.x + graceBox.width,
            katherineBox.x + katherineBox.width,
          ) + 25;
        const endY =
          Math.max(
            graceBox.y + graceBox.height,
            katherineBox.y + katherineBox.height,
          ) + 25;

        await page.keyboard.down("Shift");
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(endX, endY, { steps: 5 });
        await page.mouse.up();
        await page.keyboard.up("Shift");

        await page.getByText("2 selected").waitFor({ state: "visible" });
        await page.waitForTimeout(500);

        await page.screenshot({
          path: path.join(outputDir, `selection-desktop-${theme}.png`),
        });
      }

      await page.close();
    }

    console.log("Map selection screenshots captured successfully.");
  } finally {
    await browser.close();
    await instance.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
