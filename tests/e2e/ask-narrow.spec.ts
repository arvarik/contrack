/**
 * Ask narrows a long answer to a question made only of facets.
 *
 * The server answers `tag:zircon` from the database with no model, counts
 * every match, and offers the facets that split the whole list. A press asks
 * the question again with one added.
 *
 * The 32 contacts this spec writes start with Z, so they sort after the
 * seeded people, and they are deleted after the test, as in contact.spec.ts.
 */
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";

test("a long answer offers chips that narrow it, and a press asks again", async ({
  page,
  instance,
}, testInfo) => {
  const ids: string[] = [];
  try {
    for (let i = 0; i < 32; i++) {
      const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
        name: `Zircon ${String(i).padStart(2, "0")}`,
        industry: i < 12 ? "Zinc Mining" : undefined,
        company: i < 20 ? "Zephyr Works" : undefined,
        tags: ["zircon"],
      });
      ids.push(id);
    }

    await page.goto(`/search?q=${encodeURIComponent("tag:zircon")}`);
    await expect(
      page.getByText("30 of 32 matches", { exact: true }),
    ).toBeVisible();
    const narrow = page.getByRole("group", { name: "Narrow the list" });
    // The tag the question asks for keeps everyone, so it is no chip.
    await expect(narrow.getByRole("button")).toHaveText([
      "Zinc Mining12",
      "Zephyr Works20",
    ]);
    await expectPageAccessible(page, testInfo, "ask-narrow");

    await narrow
      .getByRole("button", { name: "Narrow to Zinc Mining, 12 people" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Ask about your network" }),
    ).toHaveValue('tag:zircon industry:"Zinc Mining"');
    await expect(page.getByText("12 matches", { exact: true })).toBeVisible();
    // The narrowed list fits, so it has nothing more to narrow.
    await expect(narrow).toHaveCount(0);
  } finally {
    if (ids.length)
      await instance.api("POST", "/contacts/bulk-delete", { ids });
  }
});
