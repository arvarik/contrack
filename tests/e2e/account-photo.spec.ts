/**
 * Profile photo lifecycle in Settings on a gated instance.
 *
 * An open instance has no account page, so this test uses gatedTest to boot
 * a fresh instance, completes initial setup, tests photo upload in Settings >
 * Account, confirms sidebar and preview updates, removes the photo, and
 * verifies accessible states throughout.
 */
import path from "path";
import { fileURLToPath } from "url";
import { gatedTest as test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import { ADMIN, completeSetup, accountMenu } from "./fixtures/accounts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PNG = path.join(__dirname, "fixtures", "avatar.png");

test("account profile photo lifecycle in Settings", async ({
  page,
}, testInfo) => {
  // 1. Complete initial setup on gated instance
  await completeSetup(page, ADMIN);

  // 2. Navigate to Settings > Account
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "Photo" })).toBeVisible();

  // Initial state check: expectPageAccessible on Account page
  await expectPageAccessible(page, testInfo, "settings-account-no-photo");

  // Verify initial monogram in sidebar and card preview
  const sidebarAvatar = accountMenu(page, ADMIN).locator("img");
  await expect(sidebarAvatar).toHaveAttribute("src", /\/api\/avatar\/initials/);

  // 3. Select and upload PNG fixture
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE_PNG);

  const uploadBtn = page.getByRole("button", { name: "Upload" });
  await expect(uploadBtn).toBeEnabled();
  await uploadBtn.click();

  // Toast confirms update
  await expect(page.getByText("Photo updated")).toBeVisible();

  // Both card preview and sidebar image src contain "/profile/"
  await expect(sidebarAvatar).toHaveAttribute("src", /\/profile\//);
  const cardImg = page.locator("section:has-text('Profile') img").first();
  await expect(cardImg).toHaveAttribute("src", /\/profile\//);

  // Accessible with photo uploaded
  await expectPageAccessible(page, testInfo, "settings-account-with-photo");

  // 4. Remove photo
  const removeBtn = page.getByRole("button", { name: "Remove photo" });
  await expect(removeBtn).toBeVisible();
  await removeBtn.click();

  // Toast confirms removal
  await expect(page.getByText("Photo removed")).toBeVisible();

  // The monogram returns
  await expect(sidebarAvatar).toHaveAttribute("src", /\/api\/avatar\/initials/);
  await expect(cardImg).toHaveAttribute("src", /\/api\/avatar\/initials/);

  // Accessible after removal
  await expectPageAccessible(page, testInfo, "settings-account-photo-removed");
});

test("captures screenshots of photo card and sidebar in light and dark", async ({
  page,
}) => {
  await completeSetup(page, ADMIN);
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "Photo" })).toBeVisible();

  // Upload photo
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE_PNG);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Photo updated")).toBeVisible();

  const sidebarAvatar = accountMenu(page, ADMIN).locator("img");
  await expect(sidebarAvatar).toHaveAttribute("src", /\/profile\//);

  // Desktop Light (1440x900)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "docs/screenshots/account-photo/settings-desktop-light.png",
    fullPage: false,
  });
  const photoCard = page.locator("section:has-text('Profile')").first();
  await photoCard.screenshot({
    path: "docs/screenshots/account-photo/card-desktop-light.png",
  });
  const sidebar = page.locator("aside").first();
  await sidebar.screenshot({
    path: "docs/screenshots/account-photo/sidebar-desktop-light.png",
  });

  // Desktop Dark (1440x900)
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "docs/screenshots/account-photo/settings-desktop-dark.png",
    fullPage: false,
  });
  await photoCard.screenshot({
    path: "docs/screenshots/account-photo/card-desktop-dark.png",
  });
  await sidebar.screenshot({
    path: "docs/screenshots/account-photo/sidebar-desktop-dark.png",
  });

  // Mobile Light (390x844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "docs/screenshots/account-photo/settings-phone-light.png",
  });
  await page.goto("/settings");
  await expect(page.locator("section.md\\:hidden img")).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/account-photo/settings-identity-phone-light.png",
  });

  // Mobile Dark (390x844)
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "docs/screenshots/account-photo/settings-identity-phone-dark.png",
  });
});
