import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { ContrackInstance } from "../tests/e2e/fixtures/instance";
import { seedInstance } from "../tests/e2e/fixtures/seed";

async function run() {
  const outputDir = path.resolve(
    process.cwd(),
    "docs/screenshots/network-header",
  );
  await fs.mkdir(outputDir, { recursive: true });

  const instance = await ContrackInstance.start({ authRequired: false });
  await seedInstance(instance);

  const browser = await chromium.launch();

  try {
    // 1. Capture Header at 390, 768, and 1440 px
    for (const vp of [
      { name: "phone-390", width: 390, height: 844 },
      { name: "tablet-768", width: 768, height: 1024 },
      { name: "desktop-1440", width: 1440, height: 900 },
    ]) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: "light",
      });

      await page.goto(`${instance.baseURL}/`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);

      await page.screenshot({
        path: path.join(outputDir, `header-${vp.name}.png`),
      });

      await page.close();
    }

    // 2. Capture StartPanel in both light and dark palettes at desktop (1440x900)
    for (const theme of ["light", "dark"] as const) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        colorScheme: theme,
      });

      await page.goto(`${instance.baseURL}/`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);

      await page.screenshot({
        path: path.join(outputDir, `start-panel-${theme}.png`),
      });

      await page.close();
    }

    console.log("Screenshots saved successfully to", outputDir);
  } finally {
    await browser.close();
    await instance.stop();
  }
}

run().catch((err) => {
  console.error("Failed to capture screenshots:", err);
  process.exit(1);
});
