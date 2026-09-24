/**
 * Settings revamped — shell, rail, search, rows and redirects.
 *
 * Covers Prompt 1 of the settings revamp:
 * - Desktop two-pane shell with 240px navigation rail
 * - Tab sequence walking the rail in order
 * - SettingRow search, keyboard selection, deep link navigation, flash and focus
 * - Modified indicator dot and reset preference button
 * - Phone single-pane view and back link behavior
 * - Redirection aliases for moved settings paths
 * - Accessibility scans for the revamped settings pages
 */
import { devices } from "@playwright/test";
import { test, gatedTest, expect } from "./fixtures/test";
import { expectPageAccessible, expectPageStructured } from "./fixtures/a11y";
import { completeSetup, ADMIN } from "./fixtures/accounts";
import type { ContrackInstance } from "./fixtures/instance";

const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

test.describe("Settings — Desktop", () => {
  test("shows the rail at the Network list's width, no back link, and the active page", async ({
    page,
  }) => {
    await page.goto("/settings");
    const rail = page.getByRole("navigation", { name: "Settings" });
    await expect(rail).toBeVisible();

    // The left pane's width, the Network list's: 350 px to open.
    const box = await rail.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 350)).toBeLessThan(2);

    // From lg the rail and the sidebar are on screen, so no page draws a
    // back link above its title.
    await expect(page.getByRole("link", { name: /^Back to/ })).toHaveCount(0);

    // Clicking Appearance navigates and marks aria-current="page"
    const appearanceLink = rail.getByRole("link", { name: "Appearance" });
    await appearanceLink.click();
    await expect(page).toHaveURL(/\/settings\/appearance/);
    await expect(appearanceLink).toHaveAttribute("aria-current", "page");

    // Heading for Appearance is rendered, with the page's one line under it,
    // and still no back link.
    const heading = page.getByRole("heading", { name: "Appearance", level: 1 });
    await expect(heading).toBeVisible();
    await expect(
      page.getByText("How Contrack looks on this account"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^Back to/ })).toHaveCount(0);

    // Every page's title starts at the same height: a settings page's and
    // Pulse's.
    const settingsTop = (await heading.boundingBox())!.y;
    await page.goto("/pulse");
    const pulseTop = (await page
      .getByRole("heading", { level: 1, name: "Pulse" })
      .boundingBox())!.y;
    expect(Math.abs(settingsTop - pulseTop)).toBeLessThan(1);
  });

  test("one rail row is lit: Correspondents does not light Connectors", async ({
    page,
  }) => {
    await page.goto("/settings/connectors/people");
    const rail = page.getByRole("navigation", { name: "Settings" });
    await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(
      rail.getByRole("link", { name: "Correspondents" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("a page's actions sit in its header, beside the title", async ({
    page,
  }) => {
    await page.goto("/settings/admin/backups");
    const header = page.locator("header").filter({
      has: page.getByRole("heading", { level: 1, name: "Backups" }),
    });
    await expect(
      header.getByRole("button", { name: "Snapshot now" }),
    ).toBeVisible();
  });

  test("tab from search box walks the rail links in order", async ({
    page,
  }) => {
    await page.goto("/settings");
    const searchInput = page.getByRole("searchbox", {
      name: "Search settings",
    });
    await searchInput.focus();

    const rail = page.getByRole("navigation", { name: "Settings" });
    const links = rail.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThan(5);

    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Tab");
      const expectedHref = await links.nth(i).getAttribute("href");
      const activeHref = await page.evaluate(() =>
        (document.activeElement as HTMLAnchorElement)?.getAttribute("href"),
      );
      expect(activeHref).toBe(expectedHref);
    }
  });

  test("search for 'celsius' lists 1 result and Enter navigates with flash and focus", async ({
    page,
  }) => {
    await page.goto("/settings");
    const searchInput = page.getByRole("searchbox", {
      name: "Search settings",
    });
    await searchInput.fill("celsius");

    // Results region opens
    const resultsContainer = page.getByRole("region", {
      name: "Search results",
    });
    await expect(resultsContainer).toBeVisible();

    const options = resultsContainer.getByRole("link");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("Temperature unit");

    // Press Enter to navigate to the result
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings\/network#temp-unit/);

    // Row is focused and flashed: the selected tint, with no ring
    const tempUnitRow = page.locator("#temp-unit");
    await expect(tempUnitRow).toBeVisible();
    await expect(tempUnitRow).toBeFocused();
    await expect(tempUnitRow).toHaveClass(/flash/);
    await expect(tempUnitRow).not.toHaveClass(/ring-2/);
  });

  test("a changed setting wears the dot, and Reset to defaults at the page's end puts it back", async ({
    page,
  }) => {
    await page.goto("/settings/appearance");

    const themeRow = page.locator("#theme");
    await expect(themeRow).toBeVisible();
    const mark = themeRow.getByRole("img", {
      name: "Changed from the default",
    });
    const reset = page.getByRole("button", { name: "Reset to defaults" });

    // At the default: no dot, no button, and no Reset in the row.
    await expect(mark).toBeHidden();
    await expect(reset).toBeHidden();
    await expect(themeRow.getByRole("button", { name: /Reset/ })).toHaveCount(
      0,
    );

    // Off the default: the dot after the title, and the page's button.
    await themeRow.getByRole("radio", { name: "Dark" }).click();
    await expect(mark).toBeVisible();
    await expect(reset).toBeVisible();

    // Set back by hand, the dot and the button go.
    await themeRow.getByRole("radio", { name: "System" }).click();
    await expect(mark).toBeHidden();
    await expect(reset).toBeHidden();

    // Off again, and Reset to defaults puts it back with an Undo.
    await themeRow.getByRole("radio", { name: "Dark" }).click();
    await reset.click();
    await expect(
      themeRow.getByRole("radio", { name: "System" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(mark).toBeHidden();
    await expect(reset).toBeHidden();
    await expect(
      page.getByText("1 setting is back to its default"),
    ).toBeVisible();
  });

  test("old URLs redirect to their new paths", async ({ page }) => {
    const redirects: [string, RegExp][] = [
      ["/settings/dedupe", /\/settings\/duplicates$/],
      ["/settings/ai-search", /\/settings\/enrichment$/],
      ["/settings/ai-config", /\/settings\/admin\/ai$/],
      ["/settings/admin/instance", /\/settings\/admin\/general$/],
      ["/settings/ai-stats", /\/settings\/admin\/ai-usage$/],
    ];

    for (const [from, to] of redirects) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });
});

test.describe("Settings — Phone", () => {
  test.use({ ...PHONE });

  /**
   * Every value `data-settings-slide` takes on the root, in order. An init
   * script runs before the document has its root element, so the watch
   * starts once it has one, and `__slides` is an empty list from then on.
   */
  const recordSlides = () => {
    const watch = () => {
      const seen: string[] = [];
      (window as { __slides?: string[] }).__slides = seen;
      new MutationObserver(() => {
        const value = document.documentElement.dataset.settingsSlide;
        if (value) seen.push(value);
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-settings-slide"],
      });
    };
    if (document.documentElement) watch();
    else document.addEventListener("DOMContentLoaded", watch, { once: true });
  };

  test("renders list on phone, opens page with back link, back returns to list", async ({
    page,
  }) => {
    // The suite reduces motion for every test, and a reduced-motion page
    // does not slide. This one checks the slide, so it asks for motion.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(recordSlides);
    await page.goto("/settings");

    // Heading for Settings is visible
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();

    // Finding A14: On phone landing page, no back control of any kind
    await expect(page.getByRole("link", { name: /^Back to/ })).toBeHidden();
    await expect(page.getByRole("button", { name: /^Back to/ })).toBeHidden();

    // Group items are listed as clickable links
    const appearanceLink = page
      .getByRole("main")
      .getByRole("link", { name: /Appearance/ });
    await expect(appearanceLink).toBeVisible();
    await appearanceLink.click();

    // Navigated to /settings/appearance
    await expect(page).toHaveURL(/\/settings\/appearance/);

    // On subpages, the back link is visible and labeled "Back to Settings"
    const subpageBack = page.getByRole("link", { name: "Back to Settings" });
    await expect(subpageBack).toBeVisible();
    await expect(subpageBack).toHaveAttribute("href", "/settings");

    // Follow it back to the list
    await subpageBack.click();
    await expect(page).toHaveURL(/\/settings$/);

    // The page slid in, and slid back out: the root said which way each
    // time, and says nothing once the slide is over.
    await expect
      .poll(() =>
        page.evaluate(() => (window as { __slides?: string[] }).__slides),
      )
      .toEqual(["forward", "back"]);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.dataset.settingsSlide),
      )
      .toBeUndefined();
  });

  test("reduced motion opens a page at once, with no slide", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(recordSlides);
    await page.goto("/settings");
    await page
      .getByRole("main")
      .getByRole("link", { name: /Appearance/ })
      .click();
    await expect(page).toHaveURL(/\/settings\/appearance/);
    await page.getByRole("link", { name: "Back to Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    // The watch ran, and saw no slide.
    expect(
      await page.evaluate(() => (window as { __slides?: string[] }).__slides),
    ).toEqual([]);
  });
});

test.describe("Settings — Personal preferences", () => {
  test("large text sets data-text-scale='large' and 17px root font", async ({
    page,
  }) => {
    await page.goto("/settings/appearance");
    const textScaleRow = page.locator("#text-scale");
    await expect(textScaleRow).toBeVisible();

    const largeRadio = textScaleRow.getByRole("radio", { name: "Large" });
    await largeRadio.click();

    await expect(page.locator("html")).toHaveAttribute(
      "data-text-scale",
      "large",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => window.getComputedStyle(document.documentElement).fontSize,
        ),
      )
      .toBe("17px");

    // Restore to default
    const defaultRadio = textScaleRow.getByRole("radio", { name: "Default" });
    await defaultRadio.click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-text-scale",
      "default",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => window.getComputedStyle(document.documentElement).fontSize,
        ),
      )
      .toBe("16px");
  });

  test("reduced motion sets data-motion='reduced'", async ({ page }) => {
    await page.goto("/settings/appearance");
    const motionRow = page.locator("#motion");
    await expect(motionRow).toBeVisible();

    const reducedRadio = motionRow.getByRole("radio", { name: "Reduced" });
    await reducedRadio.click();

    await expect(page.locator("html")).toHaveAttribute(
      "data-motion",
      "reduced",
    );

    // Restore to system
    const systemRadio = motionRow.getByRole("radio", { name: "System" });
    await systemRadio.click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "system");
  });

  test("single-key shortcuts toggle turns window-level shortcuts off and on", async ({
    page,
  }) => {
    // 1. With single-key shortcuts on (default), pressing 'n' on '/' opens the New contact modal
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace").first()).toBeVisible();
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur?.(),
    );

    await page.keyboard.press("n");
    const dialog = page.getByRole("dialog", { name: "New contact" });
    await expect(dialog).toBeVisible();

    // Close dialog
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // 2. Turn off single-key shortcuts
    await page.goto("/settings/keyboard");
    const shortcutRow = page.locator("#single-key-shortcuts");
    await expect(shortcutRow).toBeVisible();

    const switchBtn = shortcutRow.getByRole("switch", {
      name: "Single-key shortcuts",
    });
    await expect(switchBtn).toHaveAttribute("aria-checked", "true");
    await switchBtn.click();
    await expect(switchBtn).toHaveAttribute("aria-checked", "false");

    // 3. Navigate to '/' and press 'n', modal does not open
    await page.goto("/");
    // `.first()`, like step 1: the start panel's "Up next" can hold the same
    // person as the list, and which follow-ups are still open depends on what
    // else ran against this worker's instance.
    await expect(page.getByText("Ada Lovelace").first()).toBeVisible();
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur?.(),
    );

    await page.keyboard.press("n");
    await expect(dialog).toBeHidden();

    // 4. Restore single-key shortcuts to on
    await page.goto("/settings/keyboard");
    await switchBtn.click();
    await expect(switchBtn).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("Settings — Tools and Data", () => {
  test("import page uploads vCard fixture and displays it in recent imports", async ({
    page,
    instance,
  }) => {
    await page.goto("/settings/import");
    await expect(
      page.getByRole("heading", { name: "Import", level: 1 }),
    ).toBeVisible();

    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Zora E2E Test",
      "N:Test;Zora;;;",
      "EMAIL;TYPE=INTERNET:zora@example.com",
      "END:VCARD",
      "",
    ].join("\n");

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "zora.vcf",
      mimeType: "text/vcard",
      buffer: Buffer.from(vcard),
    });

    // Verify import completes
    await expect(page.getByText("Import complete")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("1 contacts processed")).toBeVisible();

    // Click Done to finish
    await page.getByRole("button", { name: "Done" }).click();

    // Verify Recent imports section displays the imported record
    const recentImports = page.getByRole("region", { name: "Recent imports" });
    await expect(recentImports).toBeVisible();
    await expect(recentImports.getByText("1 imported")).toBeVisible();

    // Cleanup: delete imported test contact
    const contacts = await instance.api<Array<{ id: string; name: string }>>(
      "GET",
      "/contacts?view=slim",
    );
    const created = contacts.find((c) => c.name === "Zora E2E Test");
    if (created) {
      await instance.api("DELETE", `/contacts/${created.id}`);
    }
  });

  test("tags page loads and displays tags list", async ({ page }) => {
    await page.goto("/settings/tags");
    await expect(
      page.getByRole("heading", { name: "Tags", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/The labels on your contacts/i)).toBeVisible();
  });

  test("duplicates page displays sensitivity and automatic check switches", async ({
    page,
  }) => {
    await page.goto("/settings/duplicates");
    await expect(
      page.getByRole("heading", { name: "Duplicates", level: 1 }),
    ).toBeVisible();

    const sensitivityRow = page.locator("#sensitivity");
    await expect(sensitivityRow).toBeVisible();

    const onCreateRow = page.locator("#dedupe-on-create");
    await expect(onCreateRow).toBeVisible();
    const onCreateSwitch = onCreateRow.getByRole("switch", {
      name: "Check new contacts automatically",
    });
    await expect(onCreateSwitch).toHaveAttribute("aria-checked", "true");

    const onImportRow = page.locator("#dedupe-on-import");
    await expect(onImportRow).toBeVisible();
    const onImportSwitch = onImportRow.getByRole("switch", {
      name: "Check imports automatically",
    });
    await expect(onImportSwitch).toHaveAttribute("aria-checked", "true");
  });

  test("enrichment page displays auto-enrich switch", async ({ page }) => {
    await page.goto("/settings/enrichment");
    await expect(
      page.getByRole("heading", { name: "Contact enrichment", level: 1 }),
    ).toBeVisible();

    const autoEnrichRow = page.locator("#auto-enrich");
    await expect(autoEnrichRow).toBeVisible();
    const autoEnrichSwitch = autoEnrichRow.getByRole("switch", {
      name: "Enrich new contacts automatically",
    });
    await expect(autoEnrichSwitch).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("Tracked contacts", () => {
  /** The contacts and the preferences this test wrote, put back when it ends. */
  const created: { instance: ContrackInstance; id: string }[] = [];
  const touched: { instance: ContrackInstance; key: string }[] = [];

  test.afterEach(async () => {
    while (created.length > 0) {
      const { instance, id } = created.pop()!;
      await instance.api("DELETE", `/contacts/${id}`);
    }
    while (touched.length > 0) {
      const { instance, key } = touched.pop()!;
      await instance.api("DELETE", `/auth/preferences/${key}`);
    }
  });

  test("Settings, Your data opens the page beside the rail, and the old path leads there", async ({
    page,
  }) => {
    await page.goto("/settings");
    const rail = page.getByRole("navigation", { name: "Settings" });
    await rail.getByRole("link", { name: "Tracked contacts" }).click();
    await expect(page).toHaveURL(/\/settings\/tracked$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Tracked contacts" }),
    ).toBeVisible();
    // The rail stays beside the page, as it does beside every settings page.
    await expect(
      rail.getByRole("link", { name: "Tracked contacts" }),
    ).toHaveAttribute("aria-current", "page");

    // The old path, with the group it named.
    await page.goto("/tracked#fading");
    await expect(page).toHaveURL(/\/settings\/tracked#fading$/);
    await expect(rail).toBeVisible();
  });

  test("the page groups people by their ring, a row toggle tracks, and Settings stays lit", async ({
    page,
    instance,
    seed,
  }, testInfo) => {
    const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
      name: "Zuri Untracked",
      company: "Journey Ltd",
    });
    created.push({ instance, id });

    await page.goto("/settings/tracked");
    await expect(
      page.getByRole("heading", { level: 1, name: "Tracked contacts" }),
    ).toBeVisible();

    // Edsger has been quiet for 400 days: At risk, and long past his cadence.
    const atRisk = page.locator("section", {
      has: page.getByRole("heading", { level: 2, name: /^At risk/ }),
    });
    await expect(
      atRisk.getByRole("link", { name: "Edsger Dijkstra" }),
    ).toBeVisible();
    await expect(
      page.locator("[data-contact-id]", { hasText: "Edsger Dijkstra" }),
    ).toContainText(/quarterly.*past due/);
    // Linus and Margaret are not tracked, and neither is the new person.
    const notTracked = page.locator("section", {
      has: page.getByRole("heading", { level: 2, name: /^Not tracked/ }),
    });
    for (const name of [
      "Linus Torvalds",
      "Margaret Hamilton",
      "Zuri Untracked",
    ]) {
      await expect(notTracked.getByRole("link", { name })).toBeVisible();
    }
    await expect(
      page.locator("[data-contact-id]", { hasText: "Linus Torvalds" }),
    ).not.toContainText("every");
    // The sidebar keeps Settings lit: this is a settings page. A selected
    // nav item wears the selected tint (`SELECTED_TINT`).
    await expect(
      page.getByRole("link", { name: "Settings", exact: true }),
    ).toHaveClass(/(?:^|\s)bg-primary\/10(?:\s|$)/);
    await expect(
      page.getByRole("link", { name: "Ada Lovelace" }),
    ).toHaveAttribute("href", `/contact/${seed.byName("Ada Lovelace").id}`);

    // The 44 px and 11 px floors are a phone's concern: metrics.spec.ts
    // scans this page at that width.
    await expectPageAccessible(page, testInfo, "tracked");
    await expectPageStructured(page, testInfo, "tracked");

    // A row toggle tracks, and the person moves to No interactions yet.
    await page.getByRole("button", { name: "Track Zuri Untracked" }).click();
    await expect(
      page.getByText("Tracking Zuri Untracked, quarterly"),
    ).toBeVisible();
    const unscored = page.locator("section", {
      has: page.getByRole("heading", {
        level: 2,
        name: /^No interactions yet/,
      }),
    });
    await expect(
      unscored.getByRole("link", { name: "Zuri Untracked" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Untrack Zuri Untracked" }),
    ).toBeVisible();

    // Select mode: the bar, and one group at a time.
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    await expect(bar).toContainText("0 selected");
    await unscored.getByRole("button", { name: "Select all" }).click();
    await expect(bar).toContainText("1 selected");
    await bar.getByRole("button", { name: "Cadence" }).click();
    await page.getByRole("menuitem", { name: "Yearly" }).click();
    await expect(page.getByText("1 contact, yearly")).toBeVisible();
    await expect(
      page.locator("[data-contact-id]", { hasText: "Zuri Untracked" }),
    ).toContainText("yearly");
    await expectPageAccessible(page, testInfo, "tracked-select");
  });

  test("the Network page has the Default cadence select and the Track new contacts switch", async ({
    page,
    instance,
  }) => {
    await page.goto("/settings/network");

    const cadence = page.getByRole("combobox", { name: "Default cadence" });
    await expect(cadence).toHaveText(/Quarterly/);
    await cadence.click();
    await expect(page.getByRole("option")).toHaveText([
      "Weekly",
      "Monthly",
      "Quarterly",
      "Yearly",
    ]);
    await page.getByRole("option", { name: "Yearly" }).click();
    touched.push({ instance, key: "defaultCadenceDays" });
    await expect(cadence).toHaveText(/Yearly/);
    // Off its default: the dot after the title.
    await expect(
      page
        .locator("#cadence")
        .getByRole("img", { name: "Changed from the default" }),
    ).toBeVisible();

    const trackNew = page.getByRole("switch", { name: "Track new contacts" });
    await expect(trackNew).toHaveAttribute("aria-checked", "false");
    await trackNew.click();
    touched.push({ instance, key: "trackNewContacts" });
    await expect(trackNew).toHaveAttribute("aria-checked", "true");

    // One Reset to defaults, at the page's end, puts both back.
    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(cadence).toHaveText(/Quarterly/);
    await expect(trackNew).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByText("2 settings are back to their defaults"),
    ).toBeVisible();
  });
});

test.describe("Settings — Accessibility", () => {
  const pages = [
    { name: "settings landing", path: "/settings" },
    { name: "appearance", path: "/settings/appearance" },
    { name: "network", path: "/settings/network" },
    { name: "keyboard", path: "/settings/keyboard" },
    { name: "privacy", path: "/settings/privacy" },
    { name: "import", path: "/settings/import" },
    { name: "tags", path: "/settings/tags" },
    { name: "duplicates", path: "/settings/duplicates" },
    { name: "enrichment", path: "/settings/enrichment" },
    { name: "mcp", path: "/settings/mcp" },
    { name: "export", path: "/settings/export" },
    { name: "admin general", path: "/settings/admin/general" },
    { name: "admin ai providers", path: "/settings/admin/ai" },
    { name: "admin mail", path: "/settings/admin/mail" },
  ];

  for (const p of pages) {
    test(`${p.name} page passes WCAG accessibility scan`, async ({
      page,
    }, testInfo) => {
      await page.goto(p.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectPageAccessible(page, testInfo, p.name);
    });
  }
});

gatedTest.describe("Settings — Admin General Page", () => {
  gatedTest(
    "opens the General page on a gated instance as admin and passes accessibility",
    async ({ page }, testInfo) => {
      await completeSetup(page, ADMIN);
      await page.goto("/settings/admin/general");
      await expect(
        page.getByRole("heading", { name: "General", level: 1 }),
      ).toBeVisible();

      // Verify all six cards are present in order
      await expect(page.locator("#name")).toBeVisible();
      await expect(page.locator("#registration")).toBeVisible();
      await expect(page.locator("#session-length")).toBeVisible();
      await expect(page.locator("#trash")).toBeVisible();
      await expect(page.locator("#backups")).toBeVisible();
      await expect(page.locator("#integrations")).toBeVisible();

      await expectPageAccessible(page, testInfo, "admin-general-gated");
    },
  );
});
