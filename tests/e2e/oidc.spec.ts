/**
 * The admin card for the OpenID Connect provider (Settings → Administration →
 * General): save with a secret preview, then remove behind a confirm dialog.
 */
import { test, gatedTest, expect } from "./fixtures/test";
import { completeSetup } from "./fixtures/accounts";
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

// The sign-in page and the account card show only while sign-in is on, so
// these run on a gated instance of their own.
gatedTest.describe("with a provider", () => {
  gatedTest.beforeEach(async ({ page }) => {
    await completeSetup(page);
    const saved = await page.request.put("/api/admin/integrations", {
      data: {
        oidc: {
          issuer: "https://id.example.com",
          clientId: "contrack",
          clientSecret: "s3cret-value-1234",
          name: "Authentik",
          matchByEmail: false,
        },
      },
    });
    expect(saved.ok()).toBe(true);
  });

  gatedTest(
    "the sign-in page offers the provider and explains a refusal",
    async ({ browser, gated }) => {
      const page = await (
        await browser.newContext({ baseURL: gated.baseURL })
      ).newPage();
      await page.goto("/?oidc=no-account");
      await expect(
        page.getByRole("link", { name: "Sign in with Authentik" }),
      ).toHaveAttribute("href", "/api/auth/oidc/start");
      await expect(page.getByRole("alert")).toContainText(
        "No Contrack account uses that sign-in",
      );
      await expect(page).toHaveURL(/\/$/);
    },
  );

  gatedTest(
    "account settings shows the single sign-on card and reports an outcome",
    async ({ page }) => {
      await page.goto("/settings/account?oidc=taken#password");
      await expect(
        page.getByRole("heading", { name: "Single sign-on" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Link Authentik" }),
      ).toBeVisible();
      await expect(
        page.getByText("That sign-in is already linked to another account"),
      ).toBeVisible();
      await expect(page).not.toHaveURL(/oidc=/);
    },
  );
});
