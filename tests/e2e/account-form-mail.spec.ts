/**
 * The email hint on the account form tells the truth about mail. With
 * outgoing mail set up, Contrack mails the reset and sign-in links somebody
 * asks for. The hint follows `mailConfigured` from `/api/auth/status`, which
 * needs a mail server, a sender and `PUBLIC_URL`, because a link cannot be
 * built from the request.
 *
 * Each test has its own instance, because both settings are read at boot.
 */
import { test, expect } from "./fixtures/test";
import { ContrackInstance } from "./fixtures/instance";
import { SETUP_HEADING } from "./fixtures/accounts";

test("says it emails links once outgoing mail is set up", async ({
  browser,
}) => {
  // The address is never dialed: this page sends nothing.
  const local = await ContrackInstance.start({
    authRequired: true,
    env: {
      SMTP_URL: "smtp://127.0.0.1:2525",
      MAIL_FROM: "Contrack <noreply@example.com>",
      PUBLIC_URL: "http://localhost:3210",
    },
  });
  try {
    const status = await local.api<{ mailConfigured: boolean }>(
      "GET",
      "/auth/status",
    );
    expect(status.mailConfigured).toBe(true);

    const context = await browser.newContext({ baseURL: local.baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: SETUP_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByText("Used to sign in, and to email you links you ask for"),
    ).toBeVisible();
    await expect(page.getByText(/never sends mail/)).toHaveCount(0);
    await context.close();
  } finally {
    await local.stop();
  }
});

test("says the server cannot send email when none is set up", async ({
  browser,
}) => {
  const local = await ContrackInstance.start({ authRequired: true });
  try {
    const context = await browser.newContext({ baseURL: local.baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: SETUP_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByText("Used to sign in. This Contrack cannot send email"),
    ).toBeVisible();
    await context.close();
  } finally {
    await local.stop();
  }
});
