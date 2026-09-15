/**
 * Forms on a phone.
 *
 * A 412-pixel viewport with touch, the shape of the Pixel 7. What changes at
 * this width: dialogs become bottom sheets, the sidebar becomes a tab bar,
 * the account identity moves to the top of Settings, and every field has to
 * be 16 pixels or larger so iOS Safari does not zoom the page when one takes
 * focus. Each of those is asserted rather than assumed.
 */
import { devices } from "@playwright/test";
import { test, gatedTest, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import { ADMIN, SETUP_HEADING, submitSignIn } from "./fixtures/accounts";
import type { Locator, Page } from "@playwright/test";

/**
 * The Pixel 7's viewport, touch, scale and user agent. The browser type is
 * left out on purpose: the project already chose Chromium, and a describe
 * block may not choose a browser, only how it is set up.
 */
const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

/** Every field in `scope` renders at 16px or more. */
async function expectPhoneSizedFields(scope: Locator, labels: string[]) {
  for (const label of labels) {
    const size = await scope
      .getByLabel(label)
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, `${label} renders at ${size}px`).toBeGreaterThanOrEqual(16);
  }
}

/** The dialog sits on the bottom edge of the viewport: a sheet, not a card. */
async function expectBottomSheet(page: Page, dialog: Locator) {
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs(box!.y + box!.height - viewport!.height)).toBeLessThan(2);
}

test.describe("open instance", () => {
  test.use({ ...PHONE });

  test("the tab bar has five real targets and marks the current one", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Primary" });
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(5);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(nav.getByRole("link", { name: "Network" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: "Ask AI" }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(nav.getByRole("link", { name: "Ask AI" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      nav.getByRole("link", { name: "Network" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("the new contact form is a bottom sheet with phone-sized fields", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    await page.getByRole("button", { name: "Add new contact or list" }).click();
    await page.getByRole("button", { name: "Add Contact" }).click();

    const dialog = page.getByRole("dialog", { name: "New Contact" });
    await expect(dialog).toBeVisible();
    await expectBottomSheet(page, dialog);
    await expectPhoneSizedFields(dialog, [
      "Full Name",
      "Role",
      "Company",
      "Email",
      "Phone",
      "Location",
    ]);
    await expectPageAccessible(page, testInfo, "new-contact-sheet", (b) =>
      b.include('[role="dialog"]'),
    );

    await dialog.getByLabel("Full Name").fill("Radia Perlman");
    await dialog.getByLabel("Company").fill("Digital Equipment");
    await dialog.getByRole("button", { name: "Save Contact" }).click();

    await expect(dialog).toBeHidden();
    // Saving keeps the list, with the new person in it, rather than leaving
    // for the detail view; a tap on the row is what opens it.
    const row = page.getByRole("link", { name: /Radia Perlman/ });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/contact\//);
    await expect(
      page.getByRole("button", { name: "Change avatar" }),
    ).toBeVisible();
  });
});

gatedTest.describe("gated instance", () => {
  gatedTest.use({ ...PHONE });

  gatedTest(
    "setup, sign-out and sign-in forms work on a phone",
    async ({ page }, testInfo) => {
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: SETUP_HEADING }),
      ).toBeVisible();
      const form = page.getByRole("main");
      await expectPhoneSizedFields(form, [
        "Your name",
        "Email",
        "Username",
        "Confirm password",
      ]);
      await expectPageAccessible(page, testInfo, "setup-phone");

      // A field's error is attached to the field, so a screen reader hears it
      // on the field itself, and the field says it is invalid.
      const email = page.getByLabel("Email");
      await email.fill("not-an-address");
      await page.keyboard.press("Tab");
      const emailError = page.getByText(
        "That doesn't look like an email address.",
      );
      await expect(emailError).toBeVisible();
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await expect(email).toHaveAttribute("aria-describedby", "email-error");
      await expect(emailError).toHaveAttribute("id", "email-error");

      await page.getByLabel("Your name").fill(ADMIN.displayName);
      await email.fill(ADMIN.email);
      await page.getByLabel("Username").fill(ADMIN.username);
      await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
      await page.getByLabel("Confirm password").fill(ADMIN.password);
      await page.getByRole("button", { name: SETUP_HEADING }).click();

      // On a phone the account lives at the top of Settings.
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Settings" })
        .click();
      await expect(page.getByText(ADMIN.displayName).first()).toBeVisible();
      await expect(page.getByText(ADMIN.email)).toBeVisible();
      await page.getByRole("button", { name: "Sign out" }).click();

      await expect(
        page.getByRole("heading", { name: "Welcome back" }),
      ).toBeVisible();
      await expectPhoneSizedFields(page.getByRole("main"), [
        "Username or email",
        "Password",
      ]);
      await expectPageAccessible(page, testInfo, "sign-in-phone");

      await submitSignIn(page, ADMIN.username, "not the password");
      await expect(page.getByRole("alert")).toHaveText(
        "Incorrect username or password.",
      );
      await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
        "",
      );

      await submitSignIn(page, ADMIN.username, ADMIN.password);
      await expect(
        page.getByRole("navigation", { name: "Primary" }),
      ).toBeVisible();
    },
  );
});
