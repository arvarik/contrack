/**
 * Dialogs — what every modal owes a keyboard user.
 *
 * Open it from the keyboard, land focus inside it, keep Tab inside it, close
 * it with Escape, and put focus back where it came from. Three dialogs are
 * walked: the shared Modal primitive (through the shortcuts overlay and the
 * new-contact form), the contact card that opens over search results, and
 * the command palette. Each open dialog is also scanned.
 */
import { test, expect } from "./fixtures/test";
import { expectFocusStaysWithin, expectPageAccessible } from "./fixtures/a11y";
import { answerPeopleSearch, personMatch } from "./fixtures/search";

test("the keyboard shortcuts dialog traps focus and returns it on Escape", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();

  const trigger = page.getByRole("button", { name: "Keyboard shortcuts" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await expect(dialog.getByText("Go to Network")).toBeVisible();

  await expectFocusStaysWithin(page, dialog, 4);
  await expectFocusStaysWithin(page, dialog, 2, "Shift+Tab");
  await expectPageAccessible(page, testInfo, "shortcuts-dialog", (b) =>
    b.include('[role="dialog"]'),
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("? opens the shortcuts dialog from anywhere that is not a field", async ({
  page,
}) => {
  await page.goto("/pulse");
  await expect(page.getByRole("heading", { name: "Pulse" })).toBeVisible();
  await page.keyboard.press("?");
  await expect(
    page.getByRole("dialog", { name: "Keyboard Shortcuts" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the new contact form opens on N, names its fields, and closes on Escape", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur?.(),
  );

  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New Contact" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Full Name")).toBeFocused();
  for (const label of ["Role", "Company", "Email", "Phone", "Location"]) {
    await expect(dialog.getByLabel(label)).toBeVisible();
  }
  await expectFocusStaysWithin(page, dialog, 8);
  await expectPageAccessible(page, testInfo, "new-contact-dialog", (b) =>
    b.include('[role="dialog"]'),
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a search result opens a contact dialog that returns focus to the result", async ({
  page,
  seed,
}, testInfo) => {
  const ada = seed.byName("Ada Lovelace");
  await answerPeopleSearch(page, [
    personMatch(ada, { role: "Analytical Engineer", company: "Babbage & Co" }),
  ]);

  await page.goto("/search");
  const input = page.getByRole("textbox", {
    name: "Ask anything about your network",
  });
  await input.fill("who knows engines");
  await input.press("Enter");

  const result = page.getByRole("button", { name: /Ada Lovelace/ });
  await expect(result).toBeVisible();
  await result.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Contact details" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close contact details" }),
  ).toBeFocused();
  // The contact's own header, with its actions menu, is inside the dialog.
  await expect(
    dialog.getByRole("button", { name: "Contact actions" }),
  ).toBeVisible();

  await expectFocusStaysWithin(page, dialog, 6);
  await expectFocusStaysWithin(page, dialog, 3, "Shift+Tab");
  await expectPageAccessible(page, testInfo, "contact-dialog", (b) =>
    b.include('[role="dialog"]'),
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(result).toBeFocused();
});

test("the command palette opens on the shortcut with its combobox focused", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");

  // The dialog element itself has no box: cmdk positions its content, so
  // the name is read from the element and visibility from what it holds.
  const palette = page.getByRole("dialog");
  await expect(palette).toHaveAttribute("data-state", "open");
  await expect(palette).toHaveAccessibleName("Global Command Palette");
  await expect(palette.getByRole("combobox")).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();

  await page.keyboard.type("Grace");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("Escape in a list inside a dialog closes the list and keeps the dialog", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await page
    .getByRole("toolbar", { name: "Bulk actions" })
    .getByRole("button", { name: "Field", exact: true })
    .click();

  const dialog = page.getByRole("dialog", { name: "Edit Field" });
  await expect(dialog).toBeVisible();
  const combo = page.getByRole("combobox", { name: "Field to edit" });
  await combo.click();

  // The list is in the top layer, and the dialog's focus trap still lets
  // its rows take focus.
  const listbox = page.getByRole("listbox", { name: "Field to edit" });
  await expect(listbox).toBeVisible();
  await expect(listbox).toHaveAttribute("popover", "manual");
  await page.keyboard.press("ArrowDown");
  await expect(listbox.getByRole("option", { name: "Company" })).toBeFocused();

  // Escape is the list's to take. The dialog listens for it on the document
  // in the capture phase, and used to close as well.
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(combo).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
