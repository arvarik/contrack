/**
 * Single sign-on end to end against the fake provider from the integration
 * tests: a refused link and a link land on Account settings with their
 * message, and the linked account then signs in from the sign-in page.
 */
import { gatedTest as test, expect } from "./fixtures/test";
import {
  ADMIN,
  completeSetup,
  expectSignedIn,
  signOutFromSidebar,
} from "./fixtures/accounts";
import { startFakeProvider } from "../integration/oidcProvider";

let provider: Awaited<ReturnType<typeof startFakeProvider>>;
test.beforeAll(async () => {
  provider = await startFakeProvider();
});
test.afterAll(async () => {
  await provider.close();
});

test("link single sign-on from Account settings, then sign in with it", async ({
  page,
}) => {
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
  try {
    await page.goto("/settings/account#password");
    const link = page.getByRole("button", { name: "Link Authentik" });

    provider.denyNextAuthorize();
    await link.click();
    await expect(page.getByText("Linking was cancelled")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/account#password$/);

    provider.nextLogin({
      sub: "ada-1",
      email: ADMIN.email,
      email_verified: true,
    });
    await link.click();
    await expect(page.getByText("Authentik linked")).toBeVisible();
    await expect(page.getByText(ADMIN.email)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/account#password$/);

    await signOutFromSidebar(page, ADMIN);
    provider.nextLogin({ sub: "ada-1" });
    await page.getByRole("link", { name: "Sign in with Authentik" }).click();
    await expectSignedIn(page, ADMIN);
  } finally {
    await page.request.put("/api/admin/integrations", { data: { oidc: null } });
  }
});
