/**
 * Which platform a social link belongs to.
 *
 * The server labels every link it saves without a platform: a link added
 * with "+ link" on the contact page, an import, an enrichment. It matched on
 * the text of the whole URL, so `includes("x.com")` made dropbox.com and
 * netflix.com "twitter". It reads the host now: the domain itself or a
 * subdomain of it, after `www.`.
 */
import { describe, expect, it } from "vitest";
import { detectPlatformFromUrl } from "../../server/repositories/contactRepository.ts";

describe("detectPlatformFromUrl", () => {
  it.each([
    ["https://www.linkedin.com/in/ada", "linkedin"],
    ["https://uk.linkedin.com/in/ada", "linkedin"],
    ["https://facebook.com/ada", "facebook"],
    ["https://m.facebook.com/ada", "facebook"],
    ["https://fb.com/ada", "facebook"],
    ["https://twitter.com/ada", "twitter"],
    ["https://x.com/ada", "twitter"],
    ["https://mobile.twitter.com/ada", "twitter"],
    ["https://github.com/ada", "github"],
    ["https://gist.github.com/ada", "github"],
    ["https://www.instagram.com/ada/", "instagram"],
    ["https://www.youtube.com/@ada", "youtube"],
    ["https://m.youtube.com/@ada", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
  ])("labels %s as %s", (url, platform) => {
    expect(detectPlatformFromUrl(url)).toBe(platform);
  });

  it.each([
    // The bug: a domain that ends in "x.com" is not x.com.
    "https://www.dropbox.com/s/abc",
    "https://www.netflix.com/title/1",
    "https://fedex.com/track",
    // A known name inside another domain, or inside the path or the query.
    "https://notgithub.com/ada",
    "https://github.com.evil.example/ada",
    "https://example.com/?next=https://linkedin.com/in/ada",
    "https://example.com/twitter.com/ada",
    "https://ada.dev",
  ])("labels %s as other", (url) => {
    expect(detectPlatformFromUrl(url)).toBe("other");
  });

  it("ignores case and the www in the host", () => {
    expect(detectPlatformFromUrl("HTTPS://WWW.GitHub.COM/Ada")).toBe("github");
  });

  it("reads a link with no scheme the way a person typed it", () => {
    // A vCard or a CSV often has these, and the old text match caught them.
    expect(detectPlatformFromUrl("www.linkedin.com/in/ada")).toBe("linkedin");
    expect(detectPlatformFromUrl("x.com/ada")).toBe("twitter");
    expect(detectPlatformFromUrl("  github.com/ada  ")).toBe("github");
  });

  it("calls anything it cannot read as a web address other", () => {
    expect(detectPlatformFromUrl("")).toBe("other");
    expect(detectPlatformFromUrl("not a url")).toBe("other");
    expect(detectPlatformFromUrl("mailto:ada@github.com")).toBe("other");
    expect(detectPlatformFromUrl("http://")).toBe("other");
  });
});
