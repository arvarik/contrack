/**
 * The shortcuts dialog, the left pane, the Tags page's links, the Duplicates
 * page and the dialogs' radio groups: what this release changed that a
 * person would find by pressing and dragging.
 */
import { test, gatedTest, expect } from "./fixtures/test";
import type { ContrackInstance } from "./fixtures/instance";
import { ADMIN, completeSetup } from "./fixtures/accounts";

test.describe("the shortcuts dialog shows the page's own keys", () => {
  test("the map's keys on the map, and none of its own on a settings page", async ({
    page,
  }) => {
    await page.goto("/map");
    await expect(page.getByRole("button", { name: /insights/i })).toBeVisible();
    await page.keyboard.press("?");
    const list = page
      .getByRole("dialog", { name: "Keyboard shortcuts" })
      .getByRole("region", { name: "Shortcut list" });
    await expect(list.getByText("Fit all in view")).toBeVisible();
    await expect(list.getByText("Go to Network")).toBeVisible();
    // Another page's keys are not on this one.
    await expect(list.getByText("New contact")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/settings/appearance");
    await expect(
      page.getByRole("heading", { level: 1, name: "Appearance" }),
    ).toBeVisible();
    await page.keyboard.press("?");
    await expect(list.getByText("No shortcuts of its own")).toBeVisible();
    await page.getByRole("link", { name: "All shortcuts" }).click();
    await expect(page).toHaveURL(/\/settings\/keyboard$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("the left pane", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Settings and the Network list share one width, and the rail's edge moves both", async ({
    page,
  }) => {
    await page.goto("/settings/appearance");
    const rail = page.getByRole("separator", {
      name: "Resize the settings list",
    });
    await expect(rail).toHaveAttribute("aria-valuenow", "350");
    await rail.focus();
    await page.keyboard.press("End");
    await expect(rail).toHaveAttribute("aria-valuenow", "480");

    await page.goto("/");
    await expect(
      page.getByRole("separator", { name: "Resize the contact list" }),
    ).toHaveAttribute("aria-valuenow", "480");
    const list = await page.locator('[data-pane="list"]').boundingBox();
    expect(Math.round(list!.width)).toBe(480);
  });

  test("shows each pane's scroll bar only while the pointer or the keyboard is in it", async ({
    page,
  }) => {
    // The thumb's colour, first in `scrollbar-color`: transparent at rest.
    const thumbShows = (scroller: ReturnType<typeof page.locator>) =>
      scroller.evaluate(
        (el) =>
          !/^(transparent|rgba\([^)]*,\s*0\))/.test(
            getComputedStyle(el).scrollbarColor,
          ),
      );

    await page.goto("/");
    const list = page.locator("#contact-list");
    await expect(list.getByRole("link").first()).toBeVisible();
    await page.mouse.move(1100, 500);
    await expect.poll(() => thumbShows(list)).toBe(false);
    await list.hover();
    await expect.poll(() => thumbShows(list)).toBe(true);
    await page.mouse.move(1100, 500);
    await expect.poll(() => thumbShows(list)).toBe(false);
    // The keyboard in the list brings it back, with the pointer elsewhere.
    // Tab from the top of the page until the focus is in the list, as a
    // person on the keyboard gets there.
    const inList = () =>
      list.evaluate((el) => el.contains(document.activeElement));
    for (let i = 0; i < 30 && !(await inList()); i++) {
      await page.keyboard.press("Tab");
    }
    expect(await inList()).toBe(true);
    await expect.poll(() => thumbShows(list)).toBe(true);

    await page.goto("/settings/appearance");
    const rail = page.getByRole("navigation", { name: "Settings" });
    await expect(rail).toBeVisible();
    await page.mouse.move(1100, 500);
    await expect.poll(() => thumbShows(rail)).toBe(false);
    await rail.hover();
    await expect.poll(() => thumbShows(rail)).toBe(true);
  });
});

test.describe("a tag on the Tags page", () => {
  const created: { instance: ContrackInstance; id: string }[] = [];
  test.afterEach(async () => {
    while (created.length > 0) {
      const { instance, id } = created.pop()!;
      await instance.api("DELETE", `/contacts/${id}`);
    }
  });

  test("opens the Network list filtered to it, spaces and all", async ({
    page,
    instance,
  }) => {
    const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
      name: "Tamsin Tagged",
      tags: ["book club"],
    });
    created.push({ instance, id });

    await page.goto("/settings/tags");
    await page.getByRole("link", { name: "book club, 1 contact" }).click();
    await expect(page).toHaveURL(/\/\?tag=book(\+|%20)club$/);
    const chip = page.getByRole("button", { name: "Filter: book club (1)" });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Tamsin Tagged")).toBeVisible();
    await expect(page.getByText("Ada Lovelace")).toHaveCount(0);

    // Pressing the chip shows everyone again.
    await chip.click();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
  });
});

test.describe("the Duplicates page", () => {
  const touched: { instance: ContrackInstance; key: string }[] = [];
  test.afterEach(async () => {
    while (touched.length > 0) {
      const { instance, key } = touched.pop()!;
      await instance.api("DELETE", `/auth/preferences/${key}`);
    }
  });

  test("puts the tool first, what runs by itself under it, and one Reset to defaults at the end", async ({
    page,
    instance,
  }) => {
    await page.goto("/settings/duplicates");
    const scan = page.getByRole("radiogroup", { name: "Scan" });
    const automatic = page.getByRole("heading", {
      level: 2,
      name: "Automatic merging",
    });
    await expect(scan).toBeVisible();
    const scanBox = (await scan.boundingBox())!;
    const automaticBox = (await automatic.boundingBox())!;
    expect(scanBox.y).toBeLessThan(automaticBox.y);
    await expect(page.getByRole("button", { name: "Scan now" })).toBeVisible();

    const reset = page.getByRole("button", { name: "Reset to defaults" });
    await expect(reset).toHaveCount(0);
    await page
      .getByRole("switch", { name: "Check imports automatically" })
      .click();
    touched.push({ instance, key: "dedupeOnImport" });
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(
      page.getByRole("switch", { name: "Check imports automatically" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(reset).toHaveCount(0);
  });
});

gatedTest(
  "a role, an expiry and a token's life are one radio group each, chosen the same way",
  async ({ page }) => {
    await completeSetup(page, ADMIN);

    // A new account's role: the chosen tile is the one Tab stop, and an
    // arrow key moves the choice and the focus together.
    await page.goto("/settings/admin/users/new");
    const account = page.getByRole("dialog", { name: "Create an account" });
    const role = account.getByRole("radiogroup", { name: "Role" });
    const member = role.getByRole("radio", { name: /^Member/ });
    const admin = role.getByRole("radio", { name: /^Admin/ });
    await expect(member).toHaveAttribute("aria-checked", "true");
    await member.focus();
    await page.keyboard.press("ArrowDown");
    await expect(admin).toHaveAttribute("aria-checked", "true");
    await expect(admin).toBeFocused();
    await page.keyboard.press("Escape");

    // An invitation's role and how long its link works.
    await page.goto("/settings/admin/invitations");
    await page.getByRole("button", { name: "New invitation" }).first().click();
    const invitation = page.getByRole("dialog", { name: "New invitation" });
    const expires = invitation.getByRole("radiogroup", { name: "Expires" });
    await expect(expires.getByRole("radio", { checked: true })).toHaveText(
      "7 days",
    );
    await expires.getByRole("radio", { name: "30 days" }).click();
    await expect(expires.getByRole("radio", { checked: true })).toHaveText(
      "30 days",
    );
    await invitation
      .getByRole("radiogroup", { name: "Role" })
      .getByRole("radio", { name: "Admin" })
      .click();
    await expect(
      invitation.getByRole("radio", { name: "Admin" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    // A token that never expires says what that costs.
    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Create token" }).click();
    const token = page.getByRole("dialog", { name: "Create a token" });
    const life = token.getByRole("radiogroup", { name: "Expires" });
    await expect(life.getByRole("radio", { checked: true })).toHaveText(
      "90 days",
    );
    await expect(token.getByText(/never expires/)).toHaveCount(0);
    await life.getByRole("radio", { name: "Never" }).click();
    await expect(token.getByText(/never expires/)).toBeVisible();
  },
);
