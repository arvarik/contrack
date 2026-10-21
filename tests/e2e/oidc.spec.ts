/**
 * The admin card for the OpenID Connect provider (Settings → Administration →
 * General): save with a secret preview, then remove behind a confirm dialog.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, gatedTest, expect } from "./fixtures/test";
import { ContrackInstance } from "./fixtures/instance";
import { completeSetup } from "./fixtures/accounts";
import { expectPageAccessible } from "./fixtures/a11y";

// Saving a provider runs discovery, so the specs need something that answers
// it. This one serves the document and nothing else; the full sign-in
// journey against a fake provider lives in its own spec.
let provider: http.Server;
let ISSUER = "";
test.beforeAll(async () => {
  provider = http.createServer((req, res) => {
    if (req.url !== "/.well-known/openid-configuration") {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      }),
    );
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  ISSUER = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

test("an admin saves and removes the OIDC provider", async ({
  page,
}, testInfo) => {
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
