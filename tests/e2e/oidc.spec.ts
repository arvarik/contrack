/**
 * Single sign-on in the browser, against the fake provider from the
 * integration tests. An admin sets up, changes and removes the provider in
 * Settings → Administration → General, OIDC_* locks it to a read-only block,
 * and a member links it from Account settings and signs in with it.
 */
import { test, gatedTest, expect } from "./fixtures/test";
import { ContrackInstance } from "./fixtures/instance";
import {
  ADMIN,
  completeSetup,
  expectSignedIn,
  signOutFromSidebar,
} from "./fixtures/accounts";
import { expectPageAccessible } from "./fixtures/a11y";
import { startFakeProvider } from "../integration/oidcProvider";

// Saving a provider runs discovery, so the specs need a provider that
// answers it.
let provider: Awaited<ReturnType<typeof startFakeProvider>>;
let ISSUER = "";
test.beforeAll(async () => {
  provider = await startFakeProvider();
  ISSUER = provider.issuer;
});
test.afterAll(async () => {
  await provider.close();
});

test("an admin sets up, changes and removes the OIDC provider", async ({
  page,
}, testInfo) => {
  // The instance is shared with the other specs in this worker.
  await page.request.put("/api/admin/integrations", { data: { oidc: null } });
  await page.goto("/settings/admin/general#oidc");
  const card = page.locator("#oidc");
  const save = card.getByRole("button", { name: "Save" });
  const matching = card.getByRole("switch", {
    name: /same verified email can sign in/i,
  });
  await expect(card.getByText("Not set up")).toBeVisible();

  // A provider that does not answer discovery is refused, and says why.
  await card.getByLabel("Issuer").fill("http://127.0.0.1:9");
  await card.getByLabel("Client ID").fill("contrack");
  await card.getByLabel("Client secret").fill("s3cret-value-1234");
  await card.getByLabel("Button name").fill("Authentik");
  await save.click();
  await expect(card.getByRole("alert")).toContainText(
    "did not answer discovery",
  );

  await card.getByLabel("Issuer").fill(ISSUER);
  await save.click();
  await expect(card.getByText("Configured")).toBeVisible();
  await expect(card.getByText("••••1234")).toBeVisible();
  await expectPageAccessible(page, testInfo, "admin-general-oidc");

  // The form fills from the saved provider, and saves the switch alone.
  await page.reload();
  await expect(card.getByLabel("Issuer")).toHaveValue(ISSUER);
  await expect(card.getByLabel("Client ID")).toHaveValue("contrack");
  await expect(save).toBeDisabled();
  await expect(matching).not.toBeChecked();
  await matching.click();
  await save.click();
  await expect(page.getByText("OpenID Connect provider saved")).toBeVisible();
  await page.reload();
  await expect(matching).toBeChecked();
  // The secret stayed: nothing asked for it again.
  await expect(card.getByText("••••1234")).toBeVisible();

  await card.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove provider" }).click();
  await expect(card.getByText("Not set up")).toBeVisible();
  // The Remove button is gone, so the keyboard lands on the empty Issuer.
  await expect(card.getByLabel("Issuer")).toBeFocused();
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
// this runs on a gated instance of its own.
gatedTest(
  "link single sign-on from Account settings, then sign in with it",
  async ({ page }) => {
    await completeSetup(page);
    const saved = await page.request.put("/api/admin/integrations", {
      data: {
        oidc: {
          issuer: provider.issuer,
          clientId: "contrack",
          clientSecret: "s3cret-value-1234",
          name: "Authentik",
          matchByEmail: false,
        },
      },
    });
    expect(saved.ok()).toBe(true);

    await page.goto("/settings/account#password");
    await expect(
      page.getByRole("heading", { name: "Single sign-on" }),
    ).toBeVisible();
    // Link asks for the current password first.
    const link = async () => {
      await page.getByRole("button", { name: "Link Authentik" }).click();
      const dialog = page.getByRole("dialog", { name: "Link Authentik" });
      await dialog.getByLabel("Current password").fill(ADMIN.password);
      await dialog.getByRole("button", { name: "Link Authentik" }).click();
    };

    // Each outcome lands as a message, and leaves the address clean.
    provider.denyNextAuthorize();
    await link();
    await expect(page.getByText("Linking was cancelled")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/account#password$/);

    provider.nextLogin({
      sub: "ada-1",
      email: ADMIN.email,
      email_verified: true,
    });
    await link();
    await expect(page.getByText("Authentik linked")).toBeVisible();
    await expect(page.getByText(ADMIN.email)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/account#password$/);

    // A provider account that nothing links is refused on the sign-in page.
    await signOutFromSidebar(page, ADMIN);
    const signIn = page.getByRole("link", { name: "Sign in with Authentik" });
    provider.nextLogin({ sub: "nobody" });
    await signIn.click();
    await expect(page.getByRole("alert")).toContainText(
      "No Contrack account uses that sign-in",
    );
    await expect(page).toHaveURL(/\/$/);
    await expect(signIn).toHaveAttribute("href", "/api/auth/oidc/start");

    provider.nextLogin({ sub: "ada-1" });
    await signIn.click();
    await expectSignedIn(page, ADMIN);

    // A flow the server could not place lands on /?oidc= even when signed in.
    await page.goto("/?oidc=failed");
    await expect(
      page.getByText("Single sign-on did not finish. Try again"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  },
);
