/**
 * E2E tests for the Passkeys sign-on journey.
 *
 * Uses CDP to attach a virtual WebAuthn authenticator, completes setup,
 * adds a passkey via the first-run nudge, signs out, signs in with the
 * passkey button without typing, inspects and removes the passkey in
 * Account settings, and asserts passkey sign-in failure with the removed passkey.
 */
import { gatedTest as test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import {
  ADMIN,
  SETUP_HEADING,
  completeSetup,
  expectSignedIn,
  signOutFromSidebar,
} from "./fixtures/accounts";

test("passkey sign-on journey: setup, nudge, passkey sign-in, account settings, and removal", async ({
  page,
  gated,
}, testInfo) => {
  const localhostBase = gated.baseURL.replace("127.0.0.1", "localhost");

  // Attach a virtual WebAuthn authenticator through CDP before the first page load
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = (await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  )) as { authenticatorId: string };

  // 1. First run: complete setup on localhost URL
  await page.goto(`${localhostBase}/`);
  await expect(
    page.getByRole("heading", { name: SETUP_HEADING }),
  ).toBeVisible();

  await page.getByLabel("Your name").fill(ADMIN.displayName);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Username").fill(ADMIN.username);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await expect(page.getByText("Strong")).toBeVisible();
  const showBtn = page.getByRole("button", { name: "Show password" });
  await expect(showBtn).toBeVisible();
  await showBtn.click();
  await expect(
    page.getByRole("button", { name: "Hide password" }),
  ).toBeVisible();
  await expectPageAccessible(page, testInfo, "setup-meter-and-toggle");
  await page.getByRole("button", { name: SETUP_HEADING }).click();

  // 2. The passkey nudge appears
  await expect(
    page.getByRole("heading", { name: "Sign in faster next time" }),
  ).toBeVisible();
  await expectPageAccessible(page, testInfo, "passkey-nudge");

  // Click "Add a passkey" -> inline registration with virtual authenticator
  await page.getByRole("button", { name: "Add a passkey" }).click();

  // App opens and user is signed in
  await expectSignedIn(page, ADMIN);

  // 3. Sign out -> lands on sign-in screen
  // Disable automatic presence simulation so passive autofill does not auto-sign in
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: false,
  });
  await signOutFromSidebar(page, ADMIN);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  // Assert passkey button is visible and run accessibility scan
  const passkeyBtn = page.getByRole("button", {
    name: "Sign in with a passkey",
  });
  await expect(passkeyBtn).toBeVisible();
  await expectPageAccessible(page, testInfo, "sign-in-passkey");

  // 4. Click "Sign in with a passkey" -> signed in without typing
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: true,
  });
  await passkeyBtn.click();
  await expectSignedIn(page, ADMIN);

  // 5. Navigate to Settings -> Account
  await page.goto(`${localhostBase}/settings/account`);
  await expect(
    page.getByRole("heading", { name: "Sign-in methods" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passkeys" })).toBeVisible();

  // Verify passkey is listed
  await expect(
    page.getByText("Synced").or(page.getByText("This device only")),
  ).toBeVisible();
  await expectPageAccessible(page, testInfo, "account-passkeys-listed");

  // 6. Remove the passkey via ConfirmDialog
  await page.getByRole("button", { name: /Remove/i }).click();
  await expect(
    page.getByRole("heading", { name: "Remove passkey" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove passkey" }).click();

  // Empty state appears
  await expect(
    page.getByText(
      "No passkeys yet. Add one to sign in without typing a password.",
    ),
  ).toBeVisible();

  // 7. Sign out and verify that passkey button now fails with alert
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: false,
  });
  await signOutFromSidebar(page, ADMIN);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: true,
  });
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    "That passkey did not work. Try again, or sign in with your password.",
  );
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: false,
  });

  // 8. Forgot password panel without mail configured (shows operator guidance)
  const forgotBtn = page.getByRole("button", {
    name: "Forgot your password?",
  });
  await expect(forgotBtn).toBeVisible();
  await forgotBtn.click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await expect(
    page.getByText("This Contrack cannot send email.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("scripts/reset-password.ts")).toBeVisible();
  await expectPageAccessible(page, testInfo, "forgot-password-panel");
  await page.getByRole("button", { name: "Back to sign in" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  // 9. Reset password dead link shape
  await page.goto(`${localhostBase}/reset-password?token=not-real`);
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("newPassword123!");
  await page.getByRole("button", { name: "Set my password" }).click();
  await expect(
    page.getByRole("heading", { name: "This reset link is no longer valid" }),
  ).toBeVisible();
  await expectPageAccessible(page, testInfo, "reset-password-dead-link");
  await page.getByRole("button", { name: "Request a new link" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
});

test("sign-in front door: password toggle and session-only cookie when remember is unchecked", async ({
  page,
  context,
  gated: _gated,
}, testInfo) => {
  // Complete setup first
  await completeSetup(page, ADMIN);

  // Sign out
  await signOutFromSidebar(page, ADMIN);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  // Test password toggle
  await page.getByLabel("Username or email").fill(ADMIN.username);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  const showToggle = page.getByRole("button", { name: "Show password" });
  await expect(showToggle).toBeVisible();
  await showToggle.click();
  const hideToggle = page.getByRole("button", { name: "Hide password" });
  await expect(hideToggle).toBeVisible();
  await hideToggle.click();
  await expect(
    page.getByRole("button", { name: "Show password" }),
  ).toBeVisible();

  // Run a11y scan on sign-in
  await expectPageAccessible(page, testInfo, "sign-in-front-door");

  // Uncheck Keep me signed in and sign in
  const keepMeSignedIn = page.getByLabel("Keep me signed in on this device");
  await expect(keepMeSignedIn).toBeChecked();
  await keepMeSignedIn.uncheck();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expectSignedIn(page, ADMIN);

  // Assert session cookie has expires: -1 (session-only)
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name === "contrack_session");
  expect(sessionCookie).toBeDefined();
  expect(sessionCookie?.expires).toBe(-1);
});
