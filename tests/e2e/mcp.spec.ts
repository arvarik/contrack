/**
 * tests/e2e/mcp.spec.ts — E2E tests for the MCP & API Settings page.
 *
 * Covers:
 * - Rail navigation, the address, the client picker and its setups, and the
 *   tools table, on an instance that asks nobody to sign in
 * - On a gated instance: a token made on the page fills the setup, shows in
 *   Account, and is gone after a reload
 * - Accessibility scan on a phone (settings.spec.ts scans the desktop page)
 *
 * @module tests/e2e/mcp.spec
 */

import { devices } from "@playwright/test";
import { test, gatedTest, expect } from "./fixtures/test";
import { completeSetup } from "./fixtures/accounts";
import { expectPageAccessible } from "./fixtures/a11y";
import { NAMES } from "../../src/lib/names";
import { MCP_TOOLS } from "../../shared/mcpTools";

const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

test.describe("Settings — MCP & API Server", () => {
  test("walks from the address to a client's setup, and lists every tool", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("link", { name: NAMES.mcp.title })
      .click();
    await expect(
      page.getByRole("heading", { name: NAMES.mcp.title, level: 1 }),
    ).toBeVisible();
    await expect(page.locator("#mcp-endpoint")).toHaveText(/\/api\/mcp$/);
    // The test server listens on 127.0.0.1, so the page says who can reach it.
    await expect(
      page.getByText("Only an assistant on this computer"),
    ).toBeVisible();

    // Sign-in is off: no token step, and no header in any setup.
    await expect(page.getByText("Give it access")).toHaveCount(0);
    const clients = page.getByRole("radiogroup", {
      name: "Where do you use it?",
    });
    await expect(page.locator("#snippet-claude-code")).toContainText(
      "--scope user contrack",
    );
    await clients.getByRole("radio", { name: "Cursor" }).click();
    await expect(page.locator("#snippet-cursor")).not.toContainText(
      "Authorization",
    );
    await expect(
      page.getByRole("link", { name: "Add to Cursor" }),
    ).toHaveAttribute(
      "href",
      /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=contrack&config=/,
    );

    await expect(page.locator("#tools tbody tr")).toHaveCount(MCP_TOOLS.length);
    await expect(page.getByText("Search people")).toBeVisible();
  });
});

gatedTest(
  "a token made on the page fills the setup, shows in Account, and leaves with a reload",
  async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await completeSetup(page);
    await page.goto("/settings/mcp");

    const snippet = page.locator("#snippet-claude-code");
    await expect(snippet).toContainText("<your-token>");
    await page
      .getByRole("radiogroup", { name: "Access" })
      .getByRole("radio", { name: "Read only" })
      .click();
    await page
      .getByRole("button", { name: "Create a token for Claude Code" })
      .click();
    await expect(page.getByText("A token named “Claude Code”")).toBeVisible();
    await expect(snippet).toContainText('--header "Authorization: Bearer ctk_');

    await page
      .getByRole("button", { name: "Copy Claude Code command" })
      .click();
    await expect(page.getByText("Claude Code command copied")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/Bearer ctk_\S+"$/);

    await page.goto("/settings/account#tokens");
    await expect(page.getByText("Claude Code", { exact: true })).toBeVisible();
    await expect(page.getByText("read-only", { exact: true })).toBeVisible();

    await page.goto("/settings/mcp");
    await expect(page.locator("#snippet-claude-code")).toContainText(
      "<your-token>",
    );
  },
);

test.describe("Settings — MCP Mobile", () => {
  test.use(PHONE);

  test("passes accessibility scan on mobile", async ({ page }, testInfo) => {
    await page.goto("/settings/mcp");
    await expect(
      page.getByRole("heading", { name: NAMES.mcp.title, level: 1 }),
    ).toBeVisible();
    await expectPageAccessible(page, testInfo, "mcp-settings-mobile");
  });
});
