/**
 * tests/e2e/mcp.spec.ts — E2E tests for the MCP & API Settings page.
 *
 * Covers:
 * - Rail navigation to /settings/mcp
 * - Endpoint URL display and copying
 * - Ephemeral token field updating configuration snippets
 * - Ephemeral token is never persisted (cleared on reload)
 * - Dynamic tools table with 15 registered tools
 * - Accessibility scans on desktop and mobile viewports
 *
 * @module tests/e2e/mcp.spec
 */

import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import { NAMES } from "../../src/lib/names";

const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

test.describe("Settings — MCP & API Server", () => {
  test("navigates to MCP settings from the rail and verifies structure", async ({
    page,
  }) => {
    await page.goto("/settings");
    const rail = page.getByRole("navigation", { name: "Settings" });
    await expect(rail).toBeVisible();

    const mcpLink = rail.getByRole("link", { name: NAMES.mcp.title });
    await expect(mcpLink).toBeVisible();
    await mcpLink.click();

    await expect(page).toHaveURL(/\/settings\/mcp/);
    await expect(
      page.getByRole("heading", { name: NAMES.mcp.title, level: 1 }),
    ).toBeVisible();

    // Verify endpoint element has /api/mcp
    const endpointInput = page.locator("#mcp-endpoint");
    await expect(endpointInput).toBeVisible();
    const endpointVal = await endpointInput.textContent();
    expect(endpointVal).toContain("/api/mcp");

    // Verify tools table displays all 15 tools
    const toolRows = page.locator("table tbody tr");
    await expect(toolRows).toHaveCount(15);
    await expect(page.getByText("search_people")).toBeVisible();
    await expect(page.getByText("get_contact")).toBeVisible();
    await expect(page.getByText("get_pulse")).toBeVisible();
    await expect(page.getByText("create_contact")).toBeVisible();
  });

  test("ephemeral token input updates snippets and is never persisted", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/settings/mcp");

    const tokenInput = page.locator("#mcp-token-input");
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toHaveValue("");

    // Initially, snippets show <your-token>
    const codeSnippet = page.locator("#claude-code");
    await expect(codeSnippet).toContainText("<your-token>");

    // Type in a mock token
    const mockToken = "ctk_e2e_test_token_12345";
    await tokenInput.fill(mockToken);

    // Snippet now reflects the typed token
    await expect(codeSnippet).toContainText(mockToken);
    await expect(codeSnippet).not.toContainText("<your-token>");

    // Claude Desktop snippet also reflects the token
    const desktopSnippet = page.locator("#claude-desktop");
    await expect(desktopSnippet).toContainText(mockToken);

    // Test copy snippet button
    const copySnippetBtn = page.getByRole("button", {
      name: "Copy Claude Code snippet",
    });
    await expect(copySnippetBtn).toBeVisible();
    await copySnippetBtn.click();
    await expect(page.getByText("Claude Code snippet copied")).toBeVisible();

    // Test copy endpoint URL button
    const copyEndpointBtn = page.getByRole("button", {
      name: "Copy MCP endpoint URL",
    });
    await expect(copyEndpointBtn).toBeVisible();
    await copyEndpointBtn.click();
    await expect(page.getByText("Endpoint URL copied")).toBeVisible();

    // Reload the page: ephemeral token should NOT be saved
    await page.reload();
    const reloadedTokenInput = page.locator("#mcp-token-input");
    await expect(reloadedTokenInput).toHaveValue("");
    await expect(page.locator("#claude-code")).toContainText("<your-token>");
  });

  test("passes accessibility scan on desktop", async ({ page }, testInfo) => {
    await page.goto("/settings/mcp");
    await expect(
      page.getByRole("heading", { name: NAMES.mcp.title, level: 1 }),
    ).toBeVisible();
    await expectPageAccessible(page, testInfo, "mcp-settings-desktop");
  });
});

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
