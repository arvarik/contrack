/**
 * The admin card for the OpenID Connect provider (Settings → Administration →
 * General): save with a secret preview, then remove behind a confirm dialog.
 */
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";

test("an admin saves and removes the OIDC provider", async ({
  page,
}, testInfo) => {
  await page.goto("/settings/admin/general#oidc");
  const card = page.locator("#oidc");
  await expect(card.getByText("Not set up")).toBeVisible();
  await card.getByLabel("Issuer").fill("https://id.example.com");
  await card.getByLabel("Client ID").fill("contrack");
  await card.getByLabel("Client secret").fill("s3cret-value-1234");
  await card.getByLabel("Button name").fill("Authentik");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Configured")).toBeVisible();
  await expect(card.getByText("••••1234")).toBeVisible();
  await expectPageAccessible(page, testInfo, "admin-general-oidc");

  await card.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove provider" }).click();
  await expect(card.getByText("Not set up")).toBeVisible();
});
