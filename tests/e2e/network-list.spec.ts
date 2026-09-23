/**
 * The Network list's pointer and search affordances.
 *
 * - A search's count sits where its results start, in the list's own label,
 *   and a screen reader hears it once the typing pauses.
 * - The row under a mouse rises, and the neighbour on the pointer's side
 *   rises as the pointer nears it (`useProximityLift`). The suite runs with
 *   reduced motion, which keeps the rows from moving, so the lift is read
 *   where the hook writes it: `--p` on each row.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";

const list = (page: Page) => page.locator("#contact-list");
const search = (page: Page) =>
  page.getByRole("textbox", { name: "Search contacts" });
const lift = (page: Page, id: string) =>
  page
    .locator(`#contact-row-${id}`)
    .evaluate((row) => Number(row.style.getPropertyValue("--p") || 0));

test.describe("Network list", () => {
  test("counts a search's matches where the results start, and says it once", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(list(page)).toBeVisible();

    await search(page).fill("Lovelace");
    await expect(
      list(page).getByText("1 match", { exact: true }),
    ).toBeVisible();
    // Once the typing pauses, in words, and once.
    await expect(
      page.getByRole("status", { name: "Contact search" }),
    ).toHaveText("1 contact found");

    // No match: the empty state says so, and no count stands over nothing.
    await search(page).fill("zzqx");
    await expect(
      page.getByRole("heading", { name: 'Nobody matches "zzqx"' }),
    ).toBeVisible();
    await expect(list(page).getByText(/\d+ match/)).toHaveCount(0);
    await expect(
      page.getByRole("status", { name: "Contact search" }),
    ).toHaveText("No contacts found");

    // No search: the list has its own labels back, and no count.
    await search(page).fill("");
    await expect(list(page).getByText(/\d+ match/)).toHaveCount(0);
  });

  test("lifts the row under the mouse, and the neighbour the pointer nears", async ({
    page,
    seed,
  }) => {
    await page.goto("/");
    const ada = seed.byName("Ada Lovelace").id;
    const row = page.locator(`#contact-row-${ada}`);
    await expect(row).toBeVisible();
    // The row under Ada's, whoever it is: other journeys on the worker's
    // instance add people who sort between the seeded ones.
    const next = await page
      .locator("#contact-list [data-proximity-row]")
      .evaluateAll((rows, id) => {
        const index = rows.findIndex((r) => r.id === `contact-row-${id}`);
        return rows[index + 1]?.id.replace("contact-row-", "") ?? "";
      }, ada);
    expect(next).not.toBe("");
    const box = (await row.boundingBox())!;

    // At the row's centre the whole lift is the row's.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => lift(page, ada)).toBeCloseTo(1, 1);

    // In its lower half the row below starts to rise, and the row keeps
    // more of the lift than its neighbour.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.9);
    await expect.poll(() => lift(page, next)).toBeGreaterThan(0);
    expect(await lift(page, ada)).toBeGreaterThan(await lift(page, next));

    // Away from the list, every row lies down.
    await page.mouse.move(box.x + box.width + 400, box.y);
    await expect.poll(() => lift(page, ada)).toBe(0);
    expect(await lift(page, next)).toBe(0);
  });
});
