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
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import { ContrackInstance } from "./fixtures/instance";
import { EMPTY_STYLE, OPENFREEMAP_ROUTE, stubBasemap } from "./fixtures/map";

/**
 * A style with something to credit. One source with an attribution, and one
 * layer on it, because MapLibre credits only a source a layer uses.
 */
const CREDITED_STYLE = {
  version: 8,
  sources: {
    credit: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      attribution: "© Test Basemap",
    },
  },
  layers: [{ id: "credit", type: "circle", source: "credit" }],
};

/**
 * The default basemap's credit, as long as it is. A short credit fits
 * anywhere, and this one ran over the stats strip at 800 and 1024 px.
 */
const LONG_CREDIT_STYLE = {
  ...CREDITED_STYLE,
  sources: {
    credit: {
      ...CREDITED_STYLE.sources.credit,
      attribution:
        '<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
};

/** True when two boxes share any area. */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

interface PinFields {
  lat: number | null;
  lng: number | null;
  geoSource: "geocoder" | "manual" | null;
}

/** Sydney. Far from everyone the seed places, so this pin is alone. */
const SYDNEY = { lat: -33.8688, lng: 151.2093 };

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
    await page.mouse.click(120, 500);
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
    // field hands focus back to the value it edited, which does not answer
    // Escape, so the next press belongs to the map page.
    await expect(
      overlay.getByRole("button", { name: "Analytical Engineer" }),
    ).toBeFocused();
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
    const cluster = page.getByRole("button", {
      name: "3 contacts, 0 at risk, zoom in",
    });
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

    // Close insights pane so Tokyo cluster on the right edge is unobstructed
    const pane = page.getByRole("complementary", { name: "Map insights" });
    await pane.getByRole("button", { name: "Close insights" }).click();
    await expect(pane).toHaveCount(0);

    await page
      .getByRole("button", { name: "2 contacts, 0 at risk, zoom in" })
      .click();
    const list = page.getByRole("list", { name: "People at this place" });
    await expect(list.getByRole("button")).toHaveCount(2);
    await list
      .getByRole("button", { name: "Alan Turing, Same Place Ltd" })
      .click();
    await expect(page).toHaveURL(/\/map\/contact\/[0-9a-f-]+$/);
    // Restore pane preference for subsequent tests
    await page.keyboard.press("i");
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
    // "Show on map" sits in the address row's kebab.
    await page.getByRole("button", { name: /^Actions for London/ }).click();
    await expect(
      page.getByRole("menuitem", { name: "Show on map" }),
    ).toHaveAttribute("href", `/map/contact/${ada.id}`);
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Open in map" }).click();
    await expect(page).toHaveURL(new RegExp(`/map/contact/${ada.id}$`));

    // The map flies to her, so her pin ends at the middle of the part of
    // the map her contact leaves open. A world view would leave it wherever
    // London falls on the screen.
    const map = page.getByRole("region", { name: "Contact map" });
    const overlay = page.getByRole("region", { name: "Contact", exact: true });
    const pin = map.getByRole("button", { name: "Ada Lovelace, Babbage & Co" });
    await expect(pin).toBeVisible();
    await expect
      .poll(
        async () => {
          const mapBox = await map.boundingBox();
          const panelBox = await overlay.boundingBox();
          const pinBox = await pin.boundingBox();
          if (!mapBox || !panelBox || !pinBox) return Number.POSITIVE_INFINITY;
          const open = panelBox.x - mapBox.x;
          const dx = pinBox.x + pinBox.width / 2 - (mapBox.x + open / 2);
          const dy =
            pinBox.y + pinBox.height / 2 - (mapBox.y + mapBox.height / 2);
          return Math.round(Math.hypot(dx, dy));
        },
        { message: "the map did not fly to the contact" },
      )
      .toBeLessThan(40);
  });

  test("moves a pin by hand, keeps it, and says who placed it", async ({
    page,
    instance,
  }, testInfo) => {
    // A contact of this test's own, so the seed's pins stay where the other
    // journeys expect them.
    const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
      name: "Pin Mover",
      company: "Handmade Ltd",
      location: "Sydney, Australia",
      ...SYDNEY,
    });
    await stubBasemap(page);
    await page.goto(`/contact/${id}`);
    await expect(
      page
        .getByRole("region", { name: "Location map" })
        .getByRole("button", { name: "Pin Mover, Handmade Ltd" }),
    ).toBeVisible();
    expect(page.getByText("Placed by hand")).toHaveCount(0);

    await page.getByRole("button", { name: "Adjust pin" }).click();
    const dialog = page.getByRole("dialog", { name: "Adjust pin" });
    const pin = dialog.getByRole("button", { name: "Pin Mover, Handmade Ltd" });
    await expect(pin).toBeVisible();
    const coordinates = dialog.getByRole("status", {
      name: "Pin coordinates",
    });
    await expect(coordinates).toHaveText("-33.86880, 151.20930");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await expectPageAccessible(page, testInfo, "adjust pin dialog");

    // Drag the pin 100 px east. The marker takes the pointer down, the map
    // takes the moves, and the pin lands where the pointer let go.
    const box = await pin.boundingBox();
    if (!box) throw new Error("The pin has no box to drag from");
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y, { steps: 4 });
    await page.mouse.move(from.x + 100, from.y, { steps: 6 });
    await page.mouse.up();

    await expect(coordinates).not.toHaveText("-33.86880, 151.20930");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Placed by hand")).toBeVisible();

    // East of where it was, on the same latitude, and marked as a person's.
    const after = await instance.api<PinFields>("GET", `/contacts/${id}`);
    expect(after.geoSource).toBe("manual");
    expect(after.lng).toBeGreaterThan(SYDNEY.lng);
    expect(after.lat).toBeCloseTo(SYDNEY.lat, 2);

    // A reload reads the pin back from the server, badge and all.
    await page.reload();
    await expect(page.getByText("Placed by hand")).toBeVisible();
  });

  test("hands a pin back to the geocoder", async ({ page, instance }) => {
    const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
      name: "Pin Returner",
      company: "Handmade Ltd",
      location: "Sydney, Australia",
      ...SYDNEY,
    });
    const placed = await instance.api<PinFields>(
      "PATCH",
      `/contacts/${id}/location`,
      { lat: -33.9, lng: 151.3 },
    );
    expect(placed.geoSource).toBe("manual");
    await stubBasemap(page);
    await page.goto(`/contact/${id}`);
    await expect(page.getByText("Placed by hand")).toBeVisible();

    await page.getByRole("button", { name: "Adjust pin" }).click();
    await page.getByRole("button", { name: "Use address again" }).click();

    // Background jobs are off on a test instance, so nothing answers the
    // geocoder: the contact waits, off the map, with the line that says so.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Not on the map yet")).toBeVisible();
    await expect(page.getByText("Placed by hand")).toHaveCount(0);
    const after = await instance.api<PinFields>("GET", `/contacts/${id}`);
    expect(after).toMatchObject({ lat: null, lng: null, geoSource: null });
  });

  test("loads a self-hosted style from this origin, with the CSP on", async ({
    browser,
  }) => {
    // An instance of its own, because the override is an operator setting
    // read at boot. The style is answered by the route below, so what this
    // proves is the chain from the setting to the request: the server
    // reports the path, the client asks this origin for it, the production
    // CSP lets the fetch through, and the map draws its pins on the answer.
    const local = await ContrackInstance.start({
      env: { MAP_STYLE_LIGHT: "/map/style.json" },
    });
    try {
      await local.api("POST", "/contacts", {
        name: "Local Style Person",
        company: "Home Ltd",
        location: "Lima, Peru",
        lat: -12.0464,
        lng: -77.0428,
      });
      const status = await local.api<{ map: { light: string; dark: string } }>(
        "GET",
        "/auth/status",
      );
      expect(status.map.light).toBe("/map/style.json");
      expect(status.map.dark).toBe("https://tiles.openfreemap.org/styles/dark");

      const context = await browser.newContext({ baseURL: local.baseURL });
      const page = await context.newPage();
      const served: string[] = [];
      await page.route("**/map/style.json", async (route) => {
        served.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(EMPTY_STYLE),
        });
      });
      const openFreeMap = await stubBasemap(page);
      await page.goto("/map");
      await expect(
        page.getByRole("button", { name: "Local Style Person, Home Ltd" }),
      ).toBeVisible();

      expect(served).toEqual([`${local.baseURL}/map/style.json`]);
      expect(openFreeMap).toEqual([]);
      await context.close();
    } finally {
      await local.stop();
    }
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

  test("remembers where it was left, across pages and across a reload", async ({
    page,
  }) => {
    await stubBasemap(page);
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    const zoomIn = map.getByRole("button", { name: "Zoom in", exact: true });
    const zoomOut = map.getByRole("button", { name: "Zoom out", exact: true });

    // A first visit opens on the whole world, where there is nothing left
    // to zoom out to. One step in, and there is.
    await expect(zoomOut).toBeDisabled();
    await zoomIn.click();
    await expect(zoomOut).toBeEnabled();

    // To another page and back, within the app: the same map, as it was.
    await page.getByRole("link", { name: "Pulse" }).first().click();
    await expect(page).toHaveURL(/\/pulse$/);
    await page.getByRole("link", { name: "Map", exact: true }).first().click();
    await expect(page).toHaveURL(/\/map$/);
    await expect(zoomOut).toBeEnabled();

    // A reload builds a new map, on the view the old one wrote down.
    await page.reload();
    await expect(
      map.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toBeVisible();
    await expect(zoomOut).toBeEnabled();
  });

  test("centres the open contact's pin in the part of the map it leaves open", async ({
    page,
  }) => {
    await stubBasemap(page);
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    const pin = map.getByRole("button", { name: "Ada Lovelace, Babbage & Co" });
    await pin.click();
    const overlay = page.getByRole("region", { name: "Contact", exact: true });
    await expect(overlay).toBeVisible();

    // The contact covers the right of the map. The pin ends in the middle
    // of what is left, and none of it under the contact.
    await expect
      .poll(
        async () => {
          const mapBox = await map.boundingBox();
          const panelBox = await overlay.boundingBox();
          const pinBox = await pin.boundingBox();
          if (!mapBox || !panelBox || !pinBox) return Number.POSITIVE_INFINITY;
          const open = panelBox.x - mapBox.x;
          if (pinBox.x + pinBox.width > panelBox.x)
            return Number.POSITIVE_INFINITY;
          const dx = pinBox.x + pinBox.width / 2 - (mapBox.x + open / 2);
          const dy =
            pinBox.y + pinBox.height / 2 - (mapBox.y + mapBox.height / 2);
          return Math.round(Math.hypot(dx, dy));
        },
        { message: "the pin did not settle beside the contact" },
      )
      .toBeLessThan(40);

    // Closed, the pin glides to the middle of the open map.
    await page.mouse.click(120, 500);
    await expect(page).toHaveURL(/\/map$/);
    const paneCount = await page
      .getByRole("complementary", { name: "Map insights" })
      .count();
    const rightCover = paneCount > 0 ? 320 : 0;
    await expect
      .poll(
        async () => {
          const mapBox = await map.boundingBox();
          const pinBox = await pin.boundingBox();
          if (!mapBox || !pinBox) return Number.POSITIVE_INFINITY;
          const openCenter = mapBox.x + (mapBox.width - rightCover) / 2;
          const dx = pinBox.x + pinBox.width / 2 - openCenter;
          const dy =
            pinBox.y + pinBox.height / 2 - (mapBox.y + mapBox.height / 2);
          return Math.round(Math.hypot(dx, dy));
        },
        { message: "the pin did not return to the middle of the map" },
      )
      .toBeLessThan(40);
  });

  test("opens the attribution collapsed, with the credit one click away", async ({
    page,
  }) => {
    // A style with a credit to show. The empty style has no source, so it
    // has no attribution and MapLibre draws no strip at all.
    await page.route(OPENFREEMAP_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CREDITED_STYLE),
      }),
    );
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(
      map.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toBeVisible();

    const toggle = map.locator(".maplibregl-ctrl-attrib-button");
    const credit = map.locator(".maplibregl-ctrl-attrib-inner");
    await expect(toggle).toBeVisible();
    await expect(credit).toBeHidden();

    await toggle.click();
    await expect(credit).toBeVisible();
    await expect(credit).toContainText("Test Basemap");
  });

  test("draws none of its own chrome until it has loaded", async ({ page }) => {
    // The style never answers, so the map never loads. That holds open the
    // one moment the chrome is wrong: MapLibre lays the full credit strip
    // across the map as soon as a style's attributions arrive, and the
    // collapse runs on load. The strip used to flash over the picture every
    // time a map opened, which on the contact page is every person a reader
    // steps to. The rule that covers it is CSS, keyed on the wrapper.
    let answer: (() => void) | null = null;
    const stalled = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route(OPENFREEMAP_ROUTE, async (route) => {
      await stalled;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CREDITED_STYLE),
      });
    });

    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toHaveAttribute("data-map-ready", "false");
    await expect
      .poll(async () =>
        map.evaluate((el) => {
          const chrome = el.querySelector(".maplibregl-control-container");
          return chrome ? getComputedStyle(chrome).visibility : "no chrome";
        }),
      )
      .toBe("hidden");

    // Let the style through: the map loads, and the chrome appears in the
    // state the collapse left it in.
    answer!();
    await expect(map).toHaveAttribute("data-map-ready", "true");
    await expect(map.locator(".maplibregl-ctrl-attrib-button")).toBeVisible();
    await expect(map.locator(".maplibregl-ctrl-attrib-inner")).toBeHidden();
  });

  test("the contact's mini map waits, then arrives loaded", async ({
    page,
    seed,
  }) => {
    await stubBasemap(page);
    const ada = seed.byName("Ada Lovelace");
    await page.goto(`/contact/${ada.id}`);

    // Nothing of the map is on screen until it has loaded: the frame holds
    // one colour, and the map fades up through it.
    const mini = page.getByRole("region", { name: "Location map" });
    await expect(mini).toHaveAttribute("data-map-ready", "true");
    await expect(
      mini.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        mini.evaluate((el) => {
          const fader = el.closest("[class*='opacity-']");
          return fader ? getComputedStyle(fader).opacity : "no fader";
        }),
      )
      .toBe("1");
  });

  test("opens the hover card above the pins", async ({ page }) => {
    await stubBasemap(page);
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await map
      .getByRole("button", { name: "Ada Lovelace, Babbage & Co" })
      .hover();
    const card = map.locator(".maplibregl-popup");
    await expect(card).toContainText("London, UK");

    // A pin carries a z-index so the open contact's pin stands above its
    // neighbours. The card stands above every pin.
    const stacking = await page.evaluate(() => {
      const above = (selector: string) =>
        Number(
          getComputedStyle(document.querySelector(selector) as Element).zIndex,
        );
      return {
        card: above(".contact-map .maplibregl-popup"),
        pin: above(".contact-map .maplibregl-marker"),
      };
    });
    expect(stacking.card).toBeGreaterThan(stacking.pin);
    expect(stacking.pin).toBeGreaterThanOrEqual(1);
  });

  test("keeps the toolbar and the stats strip clear of an open contact", async ({
    page,
    seed,
  }) => {
    // At 1440 px the contact started at x 580 and covered Fit all and the
    // end of Select. The toolbar and the corner keep to the map it leaves.
    await stubBasemap(page);
    await page.goto(`/map/contact/${seed.byName("Ada Lovelace").id}`);
    const overlay = page.getByRole("region", { name: "Contact", exact: true });
    await expect(
      overlay.getByRole("heading", { level: 1, name: /Ada Lovelace/ }),
    ).toBeVisible();
    // The contact slides in. Measure it where it comes to rest, flush with
    // the window's right edge.
    const width = page.viewportSize()!.width;
    await expect
      .poll(async () => {
        const box = await overlay.boundingBox();
        return box ? Math.round(box.x + box.width) : 0;
      })
      .toBe(width);
    const panel = (await overlay.boundingBox())!;

    const clear = [
      page.getByRole("textbox", { name: "Filter contacts" }),
      page.getByRole("button", { name: "Fit all" }),
      page.getByRole("button", { name: "Select contacts" }),
      page.getByRole("region", { name: "Map viewport statistics" }),
    ];
    for (const control of clear) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x);
    }
  });

  test("draws MapLibre's focus glow for no pointer, and the app's ring for the keyboard", async ({
    page,
  }) => {
    await stubBasemap(page);
    await page.goto("/map");
    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    await zoomIn.click();
    await expect(zoomIn).toBeFocused();
    expect(await zoomIn.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
      "none",
    );

    // Focus from the keyboard shows the ring, inset in the primary. Zoom out
    // is the next button in the group, so Shift+Tab from it is a key press
    // that lands on Zoom in. Two steps in first: at the world's zoom Zoom
    // out is disabled, and one step out would take it back there.
    await zoomIn.click();
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await page.keyboard.press("Shift+Tab");
    await expect(zoomIn).toBeFocused();
    expect(
      await zoomIn.evaluate((el) => getComputedStyle(el).boxShadow),
    ).toContain("inset");
  });

  test.describe("at 1024 px", () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test("steps the toolbar and the corner aside when a contact leaves a sliver", async ({
      page,
      seed,
    }) => {
      // The contact left 100 px of map, and the toolbar and the strip were
      // cut off in it mid-word.
      await stubBasemap(page);
      await page.goto(`/map/contact/${seed.byName("Ada Lovelace").id}`);
      const overlay = page.getByRole("region", {
        name: "Contact",
        exact: true,
      });
      await expect(
        overlay.getByRole("heading", { level: 1, name: /Ada Lovelace/ }),
      ).toBeVisible();
      // The map page owns Escape, and it arrives with the map's own chunk:
      // a ready map is the proof that the page behind the contact runs.
      await expect(
        page.getByRole("region", { name: "Contact map" }),
      ).toHaveAttribute("data-map-ready", "true");
      await expect(
        page.getByRole("textbox", { name: "Filter contacts" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Map viewport statistics" }),
      ).toHaveCount(0);

      // They come back with the whole map.
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/map$/);
      await expect(
        page.getByRole("textbox", { name: "Filter contacts" }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Map viewport statistics" }),
      ).toBeVisible();
    });

    test("opens the credit clear of the stats strip and the health legend", async ({
      page,
    }) => {
      await page.route(OPENFREEMAP_ROUTE, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(LONG_CREDIT_STYLE),
        }),
      );
      await page.goto("/map?layer=health");
      const map = page.getByRole("region", { name: "Contact map" });
      await expect(map).toHaveAttribute("data-map-ready", "true");
      const strip = page.getByRole("region", {
        name: "Map viewport statistics",
      });
      const legend = page.getByRole("group", { name: "Health legend" });
      await expect(strip).toBeVisible();
      await expect(legend).toBeVisible();

      await map.locator(".maplibregl-ctrl-attrib-button").click();
      await expect(map.locator(".maplibregl-ctrl-attrib-inner")).toContainText(
        "OpenStreetMap",
      );
      const credit = (await map
        .locator(".maplibregl-ctrl-attrib")
        .boundingBox())!;
      for (const other of [strip, legend]) {
        expect(overlaps(credit, (await other.boundingBox())!)).toBe(false);
      }
    });
  });
});

/**
 * The iPhone 13 viewport, touch and scale. The browser type is left out:
 * the project runs Chromium, and a describe block may not choose a browser.
 */
const { defaultBrowserType: _webkit, ...PHONE } = devices["iPhone 13"];

test.describe("map on a phone", () => {
  test.use({ ...PHONE });

  test("opens a contact with a tap, with no hover card, and comes back to its pin above the bar", async ({
    page,
  }) => {
    await stubBasemap(page);
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    // A portrait phone shows a slice of the world, the Americas, so the
    // pin is one of the people there. London is off the right edge.
    const pin = map.getByRole("button", {
      name: "Linus Torvalds, Linux Foundation",
    });
    await expect(pin).toBeVisible();

    await pin.tap();
    await expect(page).toHaveURL(/\/map\/contact\/[0-9a-f-]+$/);
    const overlay = page.getByRole("region", { name: "Contact", exact: true });
    await expect(
      overlay.getByRole("heading", { level: 1, name: /Linus Torvalds/ }),
    ).toBeVisible();
    // A finger cannot hover. No card opened under the contact.
    await expect(map.locator(".maplibregl-popup")).toHaveCount(0);

    await page.getByRole("button", { name: "Back" }).tap();
    await expect(page).toHaveURL(/\/map$/);
    await expect(map.locator(".maplibregl-popup")).toHaveCount(0);

    // The tab bar covers the bottom of the map. The pin sits in the middle
    // of the map above it, not in the middle of the map under it.
    const bar = page.getByRole("navigation", { name: "Primary" });
    await expect
      .poll(
        async () => {
          const mapBox = await map.boundingBox();
          const barBox = await bar.boundingBox();
          const pinBox = await pin.boundingBox();
          if (!mapBox || !barBox || !pinBox) return Number.POSITIVE_INFINITY;
          const open = barBox.y - mapBox.y;
          const dx =
            pinBox.x + pinBox.width / 2 - (mapBox.x + mapBox.width / 2);
          const dy = pinBox.y + pinBox.height / 2 - (mapBox.y + open / 2);
          return Math.round(Math.hypot(dx, dy));
        },
        { message: "the pin did not settle above the tab bar" },
      )
      .toBeLessThan(40);
  });

  test("keeps the credit clear of the stats strip, shut and open", async ({
    page,
  }) => {
    // The credit's "i" sat under the right end of the stats strip, which
    // took its taps, and the credit it opens ran under the strip. On a
    // phone the zoom buttons and the credit start one strip higher.
    await page.route(OPENFREEMAP_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CREDITED_STYLE),
      }),
    );
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toHaveAttribute("data-map-ready", "true");
    const strip = page.getByRole("region", { name: "Map viewport statistics" });
    await expect(strip).toBeVisible();
    const credit = map.locator(".maplibregl-ctrl-attrib");

    /** How far above the strip's top the credit's box ends. */
    const clearance = async () => {
      const creditBox = await credit.boundingBox();
      const stripBox = await strip.boundingBox();
      return creditBox && stripBox
        ? stripBox.y - (creditBox.y + creditBox.height)
        : Number.NEGATIVE_INFINITY;
    };
    expect(await clearance()).toBeGreaterThan(0);

    // A real tap: it fails if anything lies over the button.
    await map.locator(".maplibregl-ctrl-attrib-button").tap();
    await expect(map.locator(".maplibregl-ctrl-attrib-inner")).toContainText(
      "Test Basemap",
    );
    expect(await clearance()).toBeGreaterThan(0);
  });
});
