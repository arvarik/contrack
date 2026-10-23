/**
 * The admin card for the OpenID Connect provider (Settings → Administration →
 * General): save with a secret preview, then remove behind a confirm dialog.
 */
import { test, gatedTest, expect } from "./fixtures/test";
import { ContrackInstance } from "./fixtures/instance";
import { completeSetup } from "./fixtures/accounts";
import { expectPageAccessible } from "./fixtures/a11y";
import { startFakeProvider } from "../integration/oidcProvider";

// Saving a provider runs discovery, so the specs need a provider that
// answers it. The sign-in journey against it is oidc-journey.spec.ts.
let provider: Awaited<ReturnType<typeof startFakeProvider>>;
let ISSUER = "";
test.beforeAll(async () => {
  provider = await startFakeProvider();
  ISSUER = provider.issuer;
});
test.afterAll(async () => {
  await provider.close();
});

test("an admin saves and removes the OIDC provider", async ({
  page,
}, testInfo) => {
  // The instance is shared with the other specs in this file.
  await page.request.put("/api/admin/integrations", { data: { oidc: null } });
  await page.goto("/settings/admin/general#oidc");
  const card = page.locator("#oidc");
  await expect(card.getByText("Not set up")).toBeVisible();
  await card.getByLabel("Issuer").fill(ISSUER);
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

test("the OIDC form fills from the saved provider and saves the switch alone", async ({
  page,
}) => {
  try {
    const put = await page.request.put("/api/admin/integrations", {
      data: {
        oidc: {
          issuer: ISSUER,
          clientId: "contrack",
          clientSecret: "s3cret-value-5678",
          name: "Authentik",
          matchByEmail: false,
        },
      },
    });
    expect(put.ok()).toBe(true);

    await page.goto("/settings/admin/general#oidc");
    const card = page.locator("#oidc");
    await expect(card.getByLabel("Issuer")).toHaveValue(ISSUER);
    await expect(card.getByLabel("Client ID")).toHaveValue("contrack");
    const save = card.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();

    const matching = card.getByRole("switch", {
      name: /same verified email can sign in/i,
    });
    await expect(matching).not.toBeChecked();
    await matching.click();
    await save.click();
    await expect(page.getByText("OpenID Connect provider saved")).toBeVisible();

    await page.reload();
    await expect(
      page
        .locator("#oidc")
        .getByRole("switch", { name: /same verified email can sign in/i }),
    ).toBeChecked();
    // The secret stayed: nothing asked for it again.
    await expect(page.locator("#oidc").getByText("••••5678")).toBeVisible();
  } finally {
    await page.request.put("/api/admin/integrations", { data: { oidc: null } });
  }
});

test("the OIDC form shows why a provider was refused", async ({ page }) => {
  await page.goto("/settings/admin/general#oidc");
  const card = page.locator("#oidc");
  await card.getByLabel("Issuer").fill("http://127.0.0.1:9");
  await card.getByLabel("Client ID").fill("contrack");
  await card.getByLabel("Client secret").fill("s3cret");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("alert")).toContainText(
    "did not answer discovery",
  );
});

test("OIDC_* in the environment shows a read-only block", async ({
  browser,
}) => {
  const local = await ContrackInstance.start({
    authRequired: false,
    env: {
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: "env-client",
      OIDC_CLIENT_SECRET: "env-secret-9999",
      OIDC_NAME: "Corp login",
      OIDC_MATCH_BY_EMAIL: "true",
    },
  });
  try {
    const page = await (
      await browser.newContext({ baseURL: local.baseURL })
    ).newPage();
    await page.goto("/settings/admin/general#oidc");
    const card = page.locator("#oidc");
    await expect(card.getByText("env-client")).toBeVisible();
    await expect(card.getByText("Corp login")).toBeVisible();
    await expect(card.getByText("••••9999")).toBeVisible();
    await expect(
      card.getByText(/OIDC_MATCH_BY_EMAIL in the environment/),
    ).toBeVisible();
    await expect(card.getByLabel("Issuer")).toHaveCount(0);
  } finally {
    await local.stop();
  }
});

// The sign-in page and the account card show only while sign-in is on, so
// these run on a gated instance of their own.
gatedTest.describe("with a provider", () => {
  gatedTest.beforeEach(async ({ page }) => {
    await completeSetup(page);
    const saved = await page.request.put("/api/admin/integrations", {
      data: {
        oidc: {
          issuer: ISSUER,
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
