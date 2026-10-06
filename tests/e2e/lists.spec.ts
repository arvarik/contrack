/**
 * The Lists page (Settings → Lists): open a list, add a person from the page
 * itself, take them out and Undo it, and move a list with its row menu, the
 * way a finger or the keyboard reorders.
 */
import { expect, test } from "./fixtures/test";

test("adds people to a list, takes one out with Undo, and moves a list up", async ({
  page,
  instance,
}) => {
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
    await expect(page.getByText("No members yet")).toBeVisible();
    await add.fill("ada love");
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
