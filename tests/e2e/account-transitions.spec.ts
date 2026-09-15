/**
 * Account transitions on a gated instance.
 *
 * Every screen the gate can show, reached the way a person reaches it: the
 * setup wizard on a fresh instance, the app after it, the sign-in screen
 * after signing out, the same screen with a different explanation after a
 * session expires, and the forced password change an admin-chosen password
 * leads to. Each screen is scanned while it is showing, and each transition
 * is asserted by what the new screen says, not by a URL.
 */
import { gatedTest as test, expect } from "./fixtures/test";
import { expectPageAccessible, expectVisibleFocus } from "./fixtures/a11y";
import {
  ADMIN,
  MEMBER,
  SETUP_HEADING,
  accountMenu,
  completeSetup,
  expectSignedIn,
  signOutFromSidebar,
  submitSignIn,
} from "./fixtures/accounts";

test("first run creates the admin, and the account can sign out and back in", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: SETUP_HEADING }),
  ).toBeVisible();
  // The page has one thing to do, and focus starts on it.
  await expectVisibleFocus(page.getByLabel("Your name"));
  await expectPageAccessible(page, testInfo, "setup");

  // Submitting an empty form reveals every problem at once, each attached
  // to its field, and nothing is created.
  await page.getByRole("button", { name: SETUP_HEADING }).click();
  await expect(page.getByText("Enter an email address.")).toBeVisible();
  await expect(page.getByText("Choose a username.")).toBeVisible();
  await expect(page.getByText("Choose a password.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  await completeSetup(page, ADMIN);
  await expectPageAccessible(page, testInfo, "app-signed-in");

  await signOutFromSidebar(page, ADMIN);
  await expectVisibleFocus(page.getByLabel("Username or email"));
  await expectPageAccessible(page, testInfo, "sign-in");

  await submitSignIn(page, ADMIN.email, "wrong");
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("Incorrect username or password.");
  await expect(page.getByLabel("Username or email")).toHaveValue(ADMIN.email);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");

  await submitSignIn(page, ADMIN.email, ADMIN.password);
  await expectSignedIn(page, ADMIN);
  await expect(alert).toHaveCount(0);
});

test("an expired session returns to sign-in and says why", async ({
  page,
  context,
}, testInfo) => {
  await completeSetup(page, ADMIN);

  // The cookie goes away underneath an open tab, which is what an expiry
  // looks like from the browser. The next request is refused, and the gate
  // explains rather than showing a blank "Welcome back".
  await context.clearCookies();
  await page.getByRole("link", { name: /^Relationship Pulse/ }).click();

  await expect(page.getByRole("heading", { name: "Signed out" })).toBeVisible();
  await expect(page.getByText(/Your session expired/)).toBeVisible();
  await expectPageAccessible(page, testInfo, "sign-in-expired");

  await submitSignIn(page, ADMIN.username, ADMIN.password);
  await expectSignedIn(page, ADMIN);
});

test("a password an admin chose must be replaced before the app opens", async ({
  page,
}, testInfo) => {
  await completeSetup(page, ADMIN);

  // Created by the admin through the API the admin screens use. The browser
  // holds the admin's cookie, and `page.request` shares it.
  const temporary = "temporary-password-1";
  const created = await page.request.post("/api/admin/users", {
    data: {
      email: MEMBER.email,
      username: MEMBER.username,
      displayName: MEMBER.displayName,
      role: "member",
      temporaryPassword: temporary,
    },
  });
  expect(created.status()).toBe(201);

  await signOutFromSidebar(page, ADMIN);
  await submitSignIn(page, MEMBER.username, temporary);

  await expect(
    page.getByRole("heading", { name: "Choose your own password" }),
  ).toBeVisible();
  await expect(page.getByText(MEMBER.displayName)).toBeVisible();
  await expectVisibleFocus(page.getByLabel("Temporary password"));
  await expectPageAccessible(page, testInfo, "forced-password-change");

  // The same password again is refused before it is sent.
  await page.getByLabel("Temporary password").fill(temporary);
  await page.getByLabel("New password", { exact: true }).fill(temporary);
  await page.getByLabel("Confirm new password").fill(temporary);
  await page.getByRole("button", { name: "Set my password" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Choose a password different from the temporary one.",
  );

  await page.getByLabel("New password", { exact: true }).fill(MEMBER.password);
  await page.getByLabel("Confirm new password").fill(MEMBER.password);
  await page.getByRole("button", { name: "Set my password" }).click();

  await expectSignedIn(page, MEMBER);
  await accountMenu(page, MEMBER).click();
  await expect(page.getByText("Member", { exact: true })).toBeVisible();
  await expect(page.getByText(MEMBER.email)).toBeVisible();
});
