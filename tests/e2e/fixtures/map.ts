/**
 * A basemap that never leaves the machine.
 *
 * The map loads its style, tiles, glyphs and sprite from OpenFreeMap. A spec
 * that reached the real host would depend on a public service, spend its time
 * on tile downloads, and scan a picture that changes when the map data does.
 * So every request to the host is answered here with an empty style: a valid
 * MapLibre style with no sources and no layers. The map loads, the contacts
 * source clusters and the pins render. Only the basemap picture is missing.
 *
 * The request still leaves the page, so the production CSP is exercised: a
 * host missing from `connect-src` is refused before the route sees it.
 */
import type { Page } from "@playwright/test";

/** Every URL on the OpenFreeMap host. */
export const OPENFREEMAP_ROUTE = "**/tiles.openfreemap.org/**";

/** The smallest valid MapLibre style. */
export const EMPTY_STYLE = { version: 8, sources: {}, layers: [] };

/**
 * Answer every OpenFreeMap request with {@link EMPTY_STYLE}.
 *
 * Call before the page navigates to the map. Returns the list of URLs the
 * page asked for, filled as requests arrive, so a spec can assert which
 * style was requested.
 */
export async function stubBasemap(page: Page): Promise<string[]> {
  const requested: string[] = [];
  await page.route(OPENFREEMAP_ROUTE, async (route) => {
    requested.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_STYLE),
    });
  });
  return requested;
}
