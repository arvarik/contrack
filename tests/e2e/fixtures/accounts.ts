/**
 * The account journeys on a gated instance, as steps a spec can compose.
 *
 * Each step drives the real screen through its labels and buttons and ends
 * on the assertion that proves the transition happened, so a spec that
 * chains three of them reads as the journey and fails at the step that
 * broke.
 */
import { expect, type Page } from "@playwright/test";

export interface Account {
  displayName: string;
  email: string;
  username: string;
  password: string;
}

export const ADMIN: Account = {
  displayName: "Ada Admin",
  email: "ada.admin@example.com",
  username: "ada",
  password: "correct horse battery staple",
};

export const MEMBER: Account = {
  displayName: "Mira Member",
  email: "mira@example.com",
  username: "mira",
  password: "a password mira chose herself",
};

/** The sidebar's account menu button, named for the signed-in account. */
export function accountMenu(page: Page, account: Account) {
  return page.getByRole("button", {
    name: `Signed in as ${account.displayName}. Account menu.`,
  });
}

/**
 * The first-run heading. Every instance boots with a local owner account,
 * so a gated instance that has never been signed in to is "secured" rather
 * than "set up": the wizard converts that account instead of creating a
 * second one, and says so.
 */
export const SETUP_HEADING = "Secure this instance";

/** Fill the first-run wizard and land in the app as the new admin. */
export async function completeSetup(
  page: Page,
  account: Account = ADMIN,
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: SETUP_HEADING }),
  ).toBeVisible();
  await page.getByLabel("Your name").fill(account.displayName);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: SETUP_HEADING }).click();
  await expectSignedIn(page, account);
}

/** The app is open and names this account. */
export async function expectSignedIn(
  page: Page,
  account: Account,
): Promise<void> {
  // The sidebar identity is desktop-only; the Settings identity row is the
  // phone's. Either proves the gate opened for this account.
  await expect(
    accountMenu(page, account)
      .or(page.getByRole("link", { name: new RegExp(account.displayName) }))
      .first(),
  ).toBeVisible();
}

/** Sign out through the sidebar's account menu. Desktop widths only. */
export async function signOutFromSidebar(
  page: Page,
  account: Account,
): Promise<void> {
  await accountMenu(page, account).click();
  await page
    .getByLabel("Account", { exact: true })
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
}

/** Type a credential into the sign-in screen and submit it. */
export async function submitSignIn(
  page: Page,
  identifier: string,
  password: string,
): Promise<void> {
  await page.getByLabel("Username or email").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
