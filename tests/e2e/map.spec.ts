/**
 * The map, in a browser.
 *
 * The map is the one screen this suite cannot check by reading the DOM alone:
 * its pins exist only after MapLibre has loaded a style, clustered the
 * contacts in its worker and handed the visible features back. So the
 * journeys here are the ones that prove those parts ran: a named pin, a
 * cluster that answers a click, and the basemap that follows the palette.
 *
 * The basemap host is answered locally by `fixtures/map.ts`, so nothing here
 * waits on a public service. The request still leaves the page, which is what
 * makes the style URL assertions meaningful.
 */
import { test, expect } from "./fixtures/test";
import { stubBasemap } from "./fixtures/map";

test.describe("map", () => {
  test("shows a named pin and the zoom control", async ({ page }) => {
    await stubBasemap(page);
    await page.goto("/map");

    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();
    // London has nobody near it at world zoom, so Ada is a pin of her own.
    await expect(
      map.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toBeVisible();
    await expect(
      map.getByRole("button", { name: "Zoom in", exact: true }),
    ).toBeVisible();
  });

  test("opens a contact over the map, and a click on the map closes it", async ({
    page,
    seed,
  }) => {
    await stubBasemap(page);
    await page.goto("/map");

    await page
      .getByRole("button", { name: "Ada Lovelace, Babbage & Co" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/map/contact/${seed.byName("Ada Lovelace").id}$`),
    );
    // Exact: the map itself is a region named "Contact map".
    const overlay = page.getByRole("region", { name: "Contact", exact: true });
    await expect(
      overlay.getByRole("heading", { level: 1, name: /Ada Lovelace/ }),
    ).toBeVisible();

    // A click on the map itself, away from every pin and card.
    await page.mouse.click(120, 700);
    await expect(page).toHaveURL(/\/map$/);
    await expect(overlay).toHaveCount(0);
  });

  test("closes the contact on Escape, but not while a field is being edited", async ({
    page,
    seed,
  }) => {
    await stubBasemap(page);
    await page.goto(`/map/contact/${seed.byName("Ada Lovelace").id}`);
    const overlay = page.getByRole("region", { name: "Contact", exact: true });
    await expect(
      overlay.getByRole("heading", { level: 1, name: /Ada Lovelace/ }),
    ).toBeVisible();
    // The map page owns the key, and it arrives with the map's own chunk, so
    // a pin is the proof that the page behind the contact is running.
    await expect(
      page.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toBeVisible();

    // Escape cancels the edit. The contact stays open, because the field
    // answered the key first.
    await overlay.getByRole("button", { name: "Analytical Engineer" }).click();
    await expect(overlay.getByRole("textbox").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/map\/contact\//);
    await expect(
      overlay.getByRole("button", { name: "Analytical Engineer" }),
    ).toBeVisible();

    // With nothing else listening, Escape closes the contact. The cancelled
    // field hands focus back to the page first, and the key belongs to
    // whatever holds focus.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName))
      .toBe("BODY");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/map$/);
    await expect(overlay).toHaveCount(0);
  });

  test("zooms into a cluster until it splits", async ({ page }) => {
    await stubBasemap(page);
    await page.goto("/map");

    // Three people on the east coast of the United States at world zoom.
    const pins = page.getByRole("button", { name: /, / });
    const before = await pins.count();
    const cluster = page.getByRole("button", { name: "3 contacts, zoom in" });
    await expect(cluster).toBeVisible();
    await cluster.click();

    // The cluster is gone and at least one more person has a pin of their own.
    await expect(cluster).toHaveCount(0);
    await expect
      .poll(async () => (await pins.count()) > before, {
        message: "the cluster did not split into pins",
      })
      .toBe(true);
  });

  test("lists the people in a cluster that zooming cannot split", async ({
    page,
    instance,
  }) => {
    // Everyone the geocoder places by the same city gets the same point, so
    // past the cluster zoom their pins would sit on top of each other.
    // Tokyo, where the seed has nobody, so this is the only pair on the map.
    for (const name of ["Alan Turing", "Barbara Liskov"]) {
      await instance.api("POST", "/contacts", {
        name,
        company: "Same Place Ltd",
        location: "Tokyo, Japan",
        lat: 35.6762,
        lng: 139.6503,
      });
    }
    await stubBasemap(page);
    await page.goto("/map");

    await page.getByRole("button", { name: "2 contacts, zoom in" }).click();
    const list = page.getByRole("list", { name: "People at this place" });
    await expect(list.getByRole("button")).toHaveCount(2);
    await list
      .getByRole("button", { name: "Alan Turing, Same Place Ltd" })
      .click();
    await expect(page).toHaveURL(/\/map\/contact\/[0-9a-f-]+$/);
  });

  test("opens the map from a contact, on that contact", async ({
    page,
    seed,
  }) => {
    await stubBasemap(page);
    const ada = seed.byName("Ada Lovelace");
    await page.goto(`/contact/${ada.id}`);

    // The mini map under the address list, with her pin on it.
    const mini = page.getByRole("region", { name: "Location map" });
    await expect(
      mini.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Show on map" }).first(),
    ).toHaveAttribute("href", `/map/contact/${ada.id}`);

    await page.getByRole("link", { name: "Open in map" }).click();
    await expect(page).toHaveURL(new RegExp(`/map/contact/${ada.id}$`));

    // The map flies to her, so her pin ends at the middle of the map. A
    // world view would leave it wherever London falls on the screen.
    const map = page.getByRole("region", { name: "Contact map" });
    const pin = map.getByRole("button", { name: "Ada Lovelace, Babbage & Co" });
    await expect(pin).toBeVisible();
    await expect
      .poll(
        async () => {
          const mapBox = await map.boundingBox();
          const pinBox = await pin.boundingBox();
          if (!mapBox || !pinBox) return Number.POSITIVE_INFINITY;
          const dx =
            pinBox.x + pinBox.width / 2 - (mapBox.x + mapBox.width / 2);
          const dy =
            pinBox.y + pinBox.height / 2 - (mapBox.y + mapBox.height / 2);
          return Math.round(Math.hypot(dx, dy));
        },
        { message: "the map did not fly to the contact" },
      )
      .toBeLessThan(40);
  });

  test("asks for the dark basemap in the dark palette", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, colorScheme: "dark" });
    const page = await context.newPage();
    const requested = await stubBasemap(page);
    await page.goto("/map");
    await expect(
      page.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toBeVisible();

    expect(requested).toContain("https://tiles.openfreemap.org/styles/dark");
    expect(requested).not.toContain(
      "https://tiles.openfreemap.org/styles/positron",
    );
    await context.close();
  });
});
