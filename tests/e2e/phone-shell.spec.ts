/**
 * The app's frame on a phone.
 *
 * Covers:
 * - While a note is typed, the tab bar steps aside and Save stays in view in
 *   a keyboard-short viewport, and the editor is 16 px so iOS does not zoom
 * - A sheet has a grab handle and drags down to close
 * - The theme chosen in the app colors the browser bar
 * - Hashed assets are cached for good, and the page is checked every time
 * - On its side, the rail scrolls to Settings
 *
 * @module tests/e2e/phone-shell.spec
 */

import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";

const { defaultBrowserType: _chromium, ...PIXEL } = devices["Pixel 7"];

test.describe("phone shell", () => {
  test.use(PIXEL);

  test("typing a note hides the tab bar and keeps Save in view", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("#contact-list [data-roving-index]").first().click();
    const editor = page.locator(".ProseMirror").first();
    await editor.click();
    await page.keyboard.type("Lunch with the team");
    const tabBar = page.locator("nav[data-covers-map='bottom']");
    // No keyboard yet, so the tab bar stays. Then the height an Android
    // phone leaves the page with its keyboard up.
    await expect(tabBar).toBeVisible();
    await page.setViewportSize({ width: 412, height: 420 });
    await expect(tabBar).toBeHidden();
    // In view and on top: nothing covers the middle of Save.
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeInViewport();
    expect(
      await save.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return button.contains(hit);
      }),
    ).toBe(true);
    expect(await editor.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
      "16px",
    );
    // A long note: the line being typed stays above the Save bar.
    for (let i = 0; i < 8; i++) await page.keyboard.press("Enter");
    await page.keyboard.type("The last line");
    const bar = save.locator(
      "xpath=ancestor::div[contains(@class,'sticky')][1]",
    );
    const barTop = (await bar.boundingBox())!.y;
    const line = (await editor.locator("p").last().boundingBox())!;
    expect(line.y + line.height).toBeLessThanOrEqual(barTop);
    // Back puts the keyboard away and leaves the note focused: the tab bar
    // comes back.
    await page.setViewportSize({ width: 412, height: 839 });
    await expect(tabBar).toBeVisible();
    await expect(editor).toBeFocused();
  });

  test("a sheet drags down to close from its handle", async ({ page }) => {
    await page.goto("/?new=1");
    const sheet = page.getByRole("dialog", { name: "New contact" });
    await expect(sheet).toBeVisible();
    // A touch drag: Playwright's touchscreen only taps, so the pointer
    // events go in directly.
    await sheet
      .locator("[aria-hidden=true]")
      .first()
      .evaluate((handle) => {
        const y = handle.getBoundingClientRect().top + 5;
        for (const [type, dy] of [
          ["pointerdown", 0],
          ["pointermove", 80],
          ["pointermove", 200],
          ["pointerup", 200],
        ] as const) {
          handle.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 9,
              pointerType: "touch",
              clientX: 200,
              clientY: y + dy,
            }),
          );
        }
      });
    await expect(sheet).toBeHidden();
  });

  test("the chosen theme colors the browser bar, and hashed assets are cached for good", async ({
    page,
    request,
  }) => {
    await page.goto("/settings/appearance");
    const theme = page.getByRole("radiogroup", { name: "Theme" });
    await theme.getByRole("radio", { name: "Dark" }).click();
    const bars = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('meta[name="theme-color"]')].map(
          (meta) => (meta as HTMLMetaElement).content,
        ),
      );
    await expect.poll(bars).toEqual(["#0f1315", "#0f1315"]);
    await theme.getByRole("radio", { name: "System" }).click();
    await expect.poll(bars).toEqual(["#f8f6f2", "#0f1315"]);

    const asset = await page.evaluate(
      () =>
        (document.querySelector('script[type="module"]') as HTMLScriptElement)
          .src,
    );
    expect((await request.get(asset)).headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await request.get("/")).headers()["cache-control"]).toContain(
      "max-age=0",
    );
    // An asset the build no longer has is a 404, not the app's HTML.
    const gone = await request.get("/assets/old-chunk.js");
    expect(gone.status()).toBe(404);
  });
});

test.describe("phone on its side", () => {
  test.use({ ...PIXEL, viewport: { width: 852, height: 393 } });

  test("the rail scrolls to Settings", async ({ page }) => {
    await page.goto("/");
    const settings = page
      .locator("aside")
      .getByRole("link", { name: "Settings" });
    const rail = page.locator("aside");
    expect(await rail.evaluate((el) => getComputedStyle(el).overflowY)).toBe(
      "auto",
    );
    await settings.scrollIntoViewIfNeeded();
    await expect(settings).toBeInViewport();
  });
});
