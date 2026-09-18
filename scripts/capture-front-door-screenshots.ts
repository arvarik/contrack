import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { ContrackInstance } from "../tests/e2e/fixtures/instance";
import { ADMIN, SETUP_HEADING } from "../tests/e2e/fixtures/accounts";

async function run() {
  const outputDir = path.resolve(process.cwd(), "docs/screenshots/front-door");
  await fs.mkdir(outputDir, { recursive: true });

  const instance = await ContrackInstance.start({ authRequired: true });
  const browser = await chromium.launch();

  try {
    // 1. Capture Setup at Desktop (1440x900) and Phone (390x844)
    for (const size of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({
        viewport: { width: size.width, height: size.height },
      });
      await page.goto(instance.baseURL);
      await page.getByLabel("Your name").fill(ADMIN.displayName);
      await page.getByLabel("Email").fill(ADMIN.email);
      await page.getByLabel("Username").fill(ADMIN.username);
      await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
      await page.waitForTimeout(300);

      // Light
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(outputDir, `setup-${size.name}-light.png`),
      });

      // Dark
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(outputDir, `setup-${size.name}-dark.png`),
      });

      await page.close();
    }

    // 2. Complete setup on desktop to create account and get to sign-in
    const setupPage = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await setupPage.goto(instance.baseURL);
    await setupPage.getByLabel("Your name").fill(ADMIN.displayName);
    await setupPage.getByLabel("Email").fill(ADMIN.email);
    await setupPage.getByLabel("Username").fill(ADMIN.username);
    await setupPage
      .getByLabel("Password", { exact: true })
      .fill(ADMIN.password);
    await setupPage.getByRole("button", { name: SETUP_HEADING }).click();

    // Dismiss passkey nudge if present
    const notNow = setupPage.getByRole("button", { name: "Not now" });
    if (await notNow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await notNow.click();
    }

    // Sign out
    await setupPage
      .getByRole("button", { name: new RegExp(ADMIN.displayName) })
      .first()
      .click();
    await setupPage
      .getByLabel("Account", { exact: true })
      .getByRole("button", { name: "Sign out" })
      .click();
    await setupPage.waitForTimeout(500);
    await setupPage.close();

    // 3. Capture Sign-In at Desktop (1440x900) and Phone (390x844)
    for (const size of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
      });
      const page = await context.newPage();
      await page.goto(instance.baseURL);

      // Set contrack.lastIdentifier in localStorage to showcase "Not you?" and prefill
      await page.evaluate((val) => {
        localStorage.setItem("contrack.lastIdentifier", val);
      }, ADMIN.username);
      await page.reload();

      await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
      await page.waitForTimeout(300);

      // Light
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(outputDir, `signin-${size.name}-light.png`),
      });

      // Dark
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(outputDir, `signin-${size.name}-dark.png`),
      });

      await context.close();
    }

    console.log("Screenshots captured successfully!");
  } finally {
    await browser.close();
    await instance.stop();
  }
}

void run();
