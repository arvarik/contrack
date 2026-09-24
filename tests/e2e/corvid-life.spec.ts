/**
 * The living corvid, in a real browser with motion allowed.
 *
 * The rest of the suite forces reduced motion, so the bird holds still and
 * `brand.spec.ts` proves that holding still leaves the page exactly as it
 * was. This file turns motion back on and follows the bird through what a
 * person sees:
 *
 * - A press sends it out of its ring and it comes back to it by itself, and
 *   the ring never leaves the sidebar while it is gone.
 * - The flying bird takes no click: whatever is under it answers.
 * - Escape brings it home at once.
 * - At Subtle it stays in its ring and flutters.
 * - The Appearance row's own bird flies from its own ring and lands in it.
 *
 * Every flight is random, so every assertion is about where the bird starts
 * and ends and what it never does, not about the route it takes.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";

test.use({ reducedMotion: "no-preference" });

const perch = (page: Page) =>
  page.getByRole("button", { name: "Contrack", exact: true });
const overlay = (page: Page) => page.locator("[data-corvid-flight]");
const perchBird = (page: Page) =>
  page.locator("[data-corvid-perch] [data-bird]").first();
const perchRing = (page: Page) =>
  page.locator('[data-corvid-perch] [data-part="ring"]').first();

/** The drawing of the perch's bird as it stands now: its head and its chest. */
const perchDrawing = (page: Page) =>
  page.evaluate(() => {
    const bird = document.querySelector("[data-corvid-perch] [data-bird]")!;
    return ["head", "chest", "wing"].map((part) =>
      bird.querySelector(`[data-part="${part}"]`)!.getAttribute("d"),
    );
  });

async function setCorvidMotion(page: Page, level: "Full" | "Subtle" | "Off") {
  await page.goto("/settings/appearance");
  const radio = page
    .locator("#mascot-motion")
    .getByRole("radio", { name: level });
  await radio.click();
  await expect(radio).toHaveAttribute("aria-checked", "true");
}

test.describe("the corvid's flight", () => {
  test("leaves its ring on a press and lands back in it by itself", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    const logo = await perchDrawing(page);

    await perch(page).click();
    await expect(overlay(page)).toHaveCount(1);
    // The bird is out; the ring it sits in stays on screen, empty.
    await expect(perchBird(page)).toHaveCSS("visibility", "hidden");
    await expect(perchRing(page)).toBeVisible();

    // Every lap is different, and every lap ends.
    await expect(overlay(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(perchBird(page)).toHaveCSS("visibility", "visible");
    // Home is the logo again, from the mark's own paths.
    await expect.poll(() => perchDrawing(page)).toEqual(logo);
    await expect(perch(page)).toBeFocused();
  });

  test("takes no click while it flies over the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await perch(page).click();
    await expect(overlay(page)).toHaveCount(1);
    await page.waitForTimeout(900);

    const under = await page.evaluate(() => {
      const holder = document.querySelector("[data-corvid-flight]")!
        .firstElementChild as HTMLElement;
      const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(
        holder.style.transform,
      )!;
      const hit = document.elementFromPoint(Number(m[1]), Number(m[2]));
      return hit ? !!hit.closest("[data-corvid-flight]") : null;
    });
    expect(under).toBe(false);
  });

  test("comes home at once on Escape", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await perch(page).click();
    await expect(overlay(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveCount(0);
    await expect(perchBird(page)).toHaveCSS("visibility", "visible");
  });
});

test.describe("the Corvid motion setting, live", () => {
  test.afterEach(async ({ page }) => {
    // The instance is shared by the whole worker: put Full back.
    await setCorvidMotion(page, "Full");
  });

  test("keeps the bird in its ring at Subtle, fluttering", async ({ page }) => {
    await setCorvidMotion(page, "Subtle");
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    const logo = await perchDrawing(page);

    await perch(page).click();
    // The wings move; the bird does not leave.
    await expect.poll(() => perchDrawing(page)).not.toEqual(logo);
    await expect(overlay(page)).toHaveCount(0);
    await expect(perchBird(page)).toHaveCSS("visibility", "visible");
    // Off the perch, or the bird stays ready for the next press.
    await page.mouse.move(900, 600);
    await expect
      .poll(() => perchDrawing(page), { timeout: 8_000 })
      .toEqual(logo);
  });

  test("holds the bird still at Off, whatever is pressed", async ({ page }) => {
    await setCorvidMotion(page, "Off");
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    const logo = await perchDrawing(page);
    await perch(page).click();
    await page.waitForTimeout(600);
    await expect(overlay(page)).toHaveCount(0);
    expect(await perchDrawing(page)).toEqual(logo);
  });

  test("lets the row's own bird fly from its ring and land in it", async ({
    page,
  }) => {
    await page.goto("/settings/appearance");
    const preview = page.getByRole("button", { name: "Try the corvid" });
    await expect(preview).toBeVisible();
    await preview.click();
    await expect(overlay(page)).toHaveCount(1);
    await expect(preview.locator("[data-bird]")).toHaveCSS(
      "visibility",
      "hidden",
    );
    // The sidebar's bird stays at home: there is one bird in the air.
    await expect(perchBird(page)).toHaveCSS("visibility", "visible");
    await expect(overlay(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(preview.locator("[data-bird]")).toHaveCSS(
      "visibility",
      "visible",
    );
  });
});
