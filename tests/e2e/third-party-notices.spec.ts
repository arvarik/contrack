/**
 * The third-party notices ship with the app: the build copies
 * public/third-party-notices.txt into dist/, and the server sends it to
 * anybody who can reach the instance, before any account exists.
 */
import { gatedTest as test, expect } from "./fixtures/test";

test("the built app serves its third-party notices as plain text", async ({
  page,
}) => {
  const res = await page.request.get("/third-party-notices.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^text\/plain/);
  const text = await res.text();
  expect(text).toMatch(/^THIRD-PARTY NOTICES FOR CONTRACK/);
  expect(text).toMatch(/^heic-to \S+ {2}LGPL-3\.0/m);
});
