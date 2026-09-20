/**
 * The brand, as the browser sees it.
 *
 * Three things a unit test cannot reach. The favicon and the manifest are
 * files a server has to hand over with the right type, and a broken one shows
 * up as a blank tab rather than as a failing assertion anywhere else. The
 * sidebar mark is a button now, and the whole point of that button is that
 * pressing it changes nothing about where you are or where your focus is.
 *
 * The suite runs with `reducedMotion: "reduce"`, so the corvid holds still
 * here whatever the account's preference says. That is the assertion, not a
 * limitation: with motion reduced, Enter on the mark must leave the page
 * exactly as it found it.
 */
import { test, expect } from "./fixtures/test";
import { expectPageAccessible, expectVisibleFocus } from "./fixtures/a11y";

test.describe("the generated icons", () => {
  test("the favicon is served as an SVG", async ({ page, baseURL }) => {
    const response = await page.request.get(`${baseURL}/favicon.svg`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/svg+xml");
    const body = await response.text();
    expect(body).toContain("<svg");
    // Literal colours only: a favicon cannot read the app's CSS tokens.
    expect(body).not.toContain("var(--");
  });

  test("the page asks for the icons the manifest lists", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    const href = await page
      .locator('link[rel="icon"][type="image/svg+xml"]')
      .getAttribute("href");
    expect(href).toContain("/favicon.svg");
    // Browsers pin a favicon hard, so the link carries a version query.
    expect(href).toContain("?v=");

    const manifest = await page.request.get(`${baseURL}/site.webmanifest`);
    expect(manifest.status()).toBe(200);
    const parsed = (await manifest.json()) as {
      icons: { src: string; purpose?: string }[];
    };
    const maskable = parsed.icons.find((icon) => icon.purpose === "maskable");
    expect(maskable, "the manifest lists no maskable icon").toBeTruthy();

    const icon = await page.request.get(`${baseURL}/${maskable!.src}`);
    expect(icon.status()).toBe(200);
  });
});

test.describe("the corvid on its perch", () => {
  test("is a button named Contrack that goes nowhere", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    const perch = page.getByRole("button", { name: "Contrack", exact: true });
    await expect(perch).toBeVisible();
    await expect(perch).toHaveAttribute("title", "Let the corvid fly");

    // The drawing itself stays out of the accessibility tree: the button
    // carries the name, so a screen reader hears one thing, not two.
    await expect(perch.locator("svg")).toHaveAttribute("aria-hidden", "true");

    const before = page.url();
    await perch.focus();
    await expectVisibleFocus(perch);
    await page.keyboard.press("Enter");

    expect(page.url()).toBe(before);
    await expect(perch).toBeFocused();
  });

  test("leaves no layer over the page once the key is released", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    const perch = page.getByRole("button", { name: "Contrack", exact: true });
    await perch.focus();
    await page.keyboard.press("Enter");

    // Reduced motion is on, so the account's level resolves to "off" and no
    // overlay is ever built. Nothing can end up between a person and a
    // control they were about to click.
    await expect(page.locator("[data-corvid-flight]")).toHaveCount(0);
    await expect(perch).toBeVisible();
  });

  test("keeps the Network page accessible with the mark in the nav", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expectPageAccessible(page, testInfo, "network with the corvid");
  });
});

test.describe("the Corvid motion setting", () => {
  test("sits under Motion on the Appearance page and remembers a choice", async ({
    page,
  }, testInfo) => {
    await page.goto("/settings/appearance");

    const row = page.locator("#mascot-motion");
    await expect(
      row.getByRole("heading", { name: "Corvid motion" }),
    ).toBeVisible();

    const control = row.getByRole("radiogroup", { name: "Corvid motion" });
    await expect(control.getByRole("radio", { name: "Full" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await control.getByRole("radio", { name: "Subtle" }).click();
    await expect(
      control.getByRole("radio", { name: "Subtle" }),
    ).toHaveAttribute("aria-checked", "true");

    // The preference is on the account, so it survives a reload.
    await page.reload();
    await expect(
      page.locator("#mascot-motion").getByRole("radio", { name: "Subtle" }),
    ).toHaveAttribute("aria-checked", "true");

    await expectPageAccessible(page, testInfo, "appearance with Corvid motion");

    // Put it back, because the instance is shared by the whole worker.
    await page
      .locator("#mascot-motion")
      .getByRole("radio", { name: "Full" })
      .click();
    await expect(
      page.locator("#mascot-motion").getByRole("radio", { name: "Full" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
