/**
 * Compression, in the browser the app runs in.
 *
 * The integration tests read the bytes off the wire. This reads the page.
 * Chromium asks for `gzip, deflate, br, zstd`, also on this plain-HTTP
 * loopback origin, and decodes what comes back. The production build must
 * still work end to end: the HTML, JS, CSS and the API's JSON compressed,
 * the fonts as they are, and Ask's stream as it is, so that its first line
 * can show before the last one is written.
 *
 * The browser's own measure of each body comes from Resource Timing: its
 * size on the wire (`encodedBodySize`) and once decoded (`decodedBodySize`).
 * A compressed body is smaller on the wire.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";

interface Body {
  path: string;
  wire: number;
  decoded: number;
}

/** Every body the page has fetched so far, as the browser measured it. */
const bodies = (page: Page): Promise<Body[]> =>
  page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => {
      const timing = entry as PerformanceResourceTiming;
      const url = new URL(timing.name);
      return {
        path: url.pathname + url.search,
        wire: timing.encodedBodySize,
        decoded: timing.decodedBodySize,
      };
    }),
  );

test("the built app and its data arrive compressed, and the page works", async ({
  page,
}) => {
  const entry = page.waitForResponse((response) =>
    /^\/assets\/index-[^/]+\.js$/.test(new URL(response.url()).pathname),
  );
  const document = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/",
  );

  await page.goto("/");
  await expect(page.getByText("Ada Lovelace").first()).toBeVisible();

  for (const response of [await document, await entry]) {
    const headers = await response.allHeaders();
    expect(headers["content-encoding"], response.url()).toBe("br");
    expect(headers.vary, response.url()).toMatch(/Accept-Encoding/i);
  }

  const large = (await bodies(page)).filter((body) => body.decoded > 1024);
  const assets = large.filter((body) =>
    /^\/assets\/.+\.(js|css)$/.test(body.path),
  );
  expect(assets.length).toBeGreaterThan(3);
  for (const body of assets)
    expect(body.wire, body.path).toBeLessThan(body.decoded);

  // The API's JSON too, which the page asks for with fetch().
  const contacts = large.find(
    (body) => body.path === "/api/contacts?view=slim",
  );
  expect(contacts, "the slim contact list").toBeDefined();
  expect(contacts!.wire).toBeLessThan(contacts!.decoded);

  // A font is compressed already, and goes out as it is.
  const fonts = large.filter((body) => body.path.endsWith(".woff2"));
  expect(fonts.length).toBeGreaterThan(0);
  for (const font of fonts) expect(font.wire, font.path).toBe(font.decoded);
});

test("Ask's stream reaches the page as it is, and the answer shows", async ({
  page,
}) => {
  await page.goto("/search");
  const input = page.getByRole("textbox", {
    name: "Ask anything about your network",
  });
  const answer = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search/semantic" &&
      response.request().method() === "POST",
  );

  await input.fill("Ada Lovelace");
  await input.press("Enter");

  const response = await answer;
  const headers = await response.allHeaders();
  expect(response.request().headers().accept).toContain("application/x-ndjson");
  expect(headers["content-type"]).toContain("application/x-ndjson");
  expect(headers["content-encoding"]).toBeUndefined();
  await expect(
    page.getByRole("button", { name: /^Ada Lovelace(?!:)/ }),
  ).toBeVisible();

  // As many bytes on the wire as decoded. The entry appears once the
  // response has ended, which can be a moment after the answer shows.
  await expect
    .poll(async () => {
      const stream = (await bodies(page)).find(
        (body) => body.path === "/api/search/semantic",
      );
      return stream && stream.decoded > 0 && stream.wire === stream.decoded;
    })
    .toBe(true);
});
