/**
 * An app's OAuth sign-in, in the built app.
 *
 * One journey on a phone: an app opens the authorize link while nobody is
 * signed in, the person signs in on the same page, sees who is asking and
 * where they go back to, chooses Read only, and lands back at the app with
 * a code. The code then buys a token that sees only the read tools.
 *
 * It proves what a unit test cannot: the Strict session cookie path, the
 * return to the request after sign-in, and that the browser leaves for the
 * app under the production CSP.
 *
 * @module tests/e2e/oauth.spec
 */

import crypto from "node:crypto";
import { devices, test as base } from "@playwright/test";
import { expect } from "./fixtures/test";
import { ContrackInstance } from "./fixtures/instance";
import { ADMIN, completeSetup, submitSignIn } from "./fixtures/accounts";
import { expectPageAccessible } from "./fixtures/a11y";
import { MCP_TOOLS } from "../../shared/mcpTools";

const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];
const CALLBACK = "http://127.0.0.1:43999/callback";

const test = base.extend<{ instance: ContrackInstance }>({
  // eslint-disable-next-line no-empty-pattern
  instance: async ({}, use) => {
    const instance = await ContrackInstance.start({
      authRequired: true,
      publicUrl: true,
    });
    await use(instance);
    await instance.stop();
  },
  baseURL: async ({ instance }, use) => {
    await use(instance.baseURL);
  },
});

test.use(PHONE);

test("an app signs in: sign in, choose Read only, and go back with a code", async ({
  browser,
  page,
  request,
  baseURL,
}, testInfo) => {
  // The first account, made at desktop width where the setup helper looks
  // for the sidebar. The journey itself runs on the phone, signed out.
  const desk = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 800 },
  });
  await completeSetup(await desk.newPage());
  await desk.close();

  const registered = await request.post("/oauth/register", {
    data: { client_name: "E2E Assistant", redirect_uris: [CALLBACK] },
  });
  const { client_id: clientId } = await registered.json();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  await page.route(`${CALLBACK}**`, (route) =>
    route.fulfill({ contentType: "text/plain", body: "Back in the app" }),
  );

  await page.goto(
    `/oauth/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(CALLBACK)}&state=e2e` +
      `&code_challenge=${challenge}&code_challenge_method=S256`,
  );
  await expect(page).toHaveURL(/\/oauth\/consent\?request=/);
  await submitSignIn(page, ADMIN.username, ADMIN.password);

  await expect(
    page.getByRole("heading", {
      name: "Allow an app that calls itself “E2E Assistant” to use your Contrack?",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Any app can call itself anything"),
  ).toBeVisible();
  await expect(
    page.getByText("an app on this computer (127.0.0.1:43999)"),
  ).toBeVisible();
  await expectPageAccessible(page, testInfo, "oauth-consent-phone");

  await page
    .getByRole("radiogroup", { name: "Access" })
    .getByRole("radio", { name: /^Read only/ })
    .click();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:43999\/callback\?/);
  const back = new URL(page.url());
  expect(back.searchParams.get("state")).toBe("e2e");
  expect(back.searchParams.get("iss")).toBe(baseURL);

  const tokens = await request.post("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
      client_id: clientId,
    },
  });
  const { access_token: accessToken } = await tokens.json();
  const listed = await request.post("/api/mcp", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  const body = await listed.text();
  for (const tool of MCP_TOOLS) {
    expect(body.includes(`"${tool.name}"`), tool.name).toBe(
      tool.effect === "read",
    );
  }
});
