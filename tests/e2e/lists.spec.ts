/**
 * The Lists page (Settings → Lists): open a list, add a person from the page
 * itself, take them out and Undo it, and move a list with its row menu, the
 * way a finger or the keyboard reorders.
 */
import { expectPageAccessible } from "./fixtures/a11y";
import { expect, test } from "./fixtures/test";

test("adds people to a list, takes one out with Undo, and moves a list up", async ({
  page,
  instance,
}, testInfo) => {
  const made: string[] = [];
  const make = async (name: string) => {
    const { id } = await instance.api<{ id: string }>("POST", "/lists", {
      name,
      icon: "star",
    });
    made.push(id);
  };
  try {
    await make("zz Lists first");
    await make("zz Lists second");
    await page.goto("/settings/lists");

    const rows = page
      .getByRole("list", { name: "Lists" })
      .getByRole("listitem")
      .filter({ hasText: /zz Lists/ });
    const second = rows.filter({ hasText: "zz Lists second" });
    await second.getByRole("button").first().click();
    const add = page.getByRole("combobox", { name: "Add people" });
    // Each width has its own copy of the panel: the one on screen.
    await expect(
      page.getByText("No members yet").filter({ visible: true }),
    ).toBeVisible();
    await add.fill("ada love");
    await expect(
      page.getByRole("option", { name: /Ada Lovelace/ }),
    ).toBeVisible();
    await expectPageAccessible(page, testInfo, "settings-lists-add-people");
    await add.press("Enter");
    // The field keeps the focus for the next name.
    await expect(add).toBeFocused();
    const remove = page.getByRole("button", {
      name: "Remove Ada Lovelace from list",
    });
    await expect(remove).toBeVisible();

    await remove.click();
    await expect(remove).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(remove).toBeVisible();

    // Move up puts the second list above the first.
    await second
      .getByRole("button", { name: "zz Lists second actions" })
      .click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect(rows).toHaveText([/zz Lists second/, /zz Lists first/]);
  } finally {
    for (const id of made) await instance.api("DELETE", `/lists/${id}`);
  }
});

test("gives focus back to the list's row when its panel closes, and deletes a list through its dialog", async ({
  page,
  instance,
}) => {
  const { id } = await instance.api<{ id: string }>("POST", "/lists", {
    name: "zz Lists to delete",
    icon: "star",
  });
  try {
    await page.goto("/settings/lists");
    const row = page.locator("[data-list-row]:visible", {
      hasText: "zz Lists to delete",
    });
    await row.click();
    // The panel's X took the focus away with it: the row has it back.
    await page.getByRole("button", { name: "Close list" }).click();
    await expect(row).toBeFocused();

    await row.click();
    const remove = page.getByRole("button", { name: "Delete list" });
    await remove.click();
    const dialog = page.getByRole("dialog", {
      name: 'Delete the list "zz Lists to delete"?',
    });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(remove).toBeFocused();
    await remove.click();
    await dialog.getByRole("button", { name: "Delete list" }).click();
    await expect(row).toHaveCount(0);
    // Focus lands in the lists (a row, or New list when none is left), not
    // on the page.
    await expect
      .poll(() =>
        page.evaluate(
          () => !!document.activeElement?.closest("[data-list-pane]"),
        ),
      )
      .toBe(true);
  } finally {
    await instance.api("DELETE", `/lists/${id}`).catch(() => {});
  }
});
