import { describe, it, expect } from "vitest";
import { safeHref, cleanLinkedInSlug } from "../../../../src/lib/utils";

describe("safeHref", () => {
  it.each([
    "http://example.com",
    "https://example.com/path?q=1",
    "mailto:jane@example.com",
    "tel:+15551234567",
    // A relative path starting with /
    "/uploads/file.pdf",
  ])("allows %j", (url) => {
    expect(safeHref(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    // Mixed case and whitespace
    "  JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    // Bare strings that are not URLs or rooted paths
    "example.com",
    "not a url",
    null,
    undefined,
    "",
    "   ",
  ])("rejects %j", (url) => {
    expect(safeHref(url)).toBeUndefined();
  });
});

describe("cleanLinkedInSlug", () => {
  // The six documented examples from the original heuristic, then a name
  // with no suffix.
  it.each([
    // A numeric auto-generated suffix
    ["alex-sadler-07993773", "alex-sadler"],
    // A hex auto-generated suffix
    ["alexander-glavin-17b821a8", "alexander-glavin"],
    // The suffix goes, the short name initial stays
    ["yuxuan-jonathan-c-027b18156", "yuxuan-jonathan-c"],
    // A mixed alphanumeric suffix
    ["young-lee-78ab07111", "young-lee"],
    // Custom usernames without hyphens stay, digits and all
    ["aayush1196", "aayush1196"],
    ["wangxi05104", "wangxi05104"],
    // A short name segment without digits stays
    ["jane-doe", "jane-doe"],
  ])("shows %j as %j", (slug, display) => {
    expect(cleanLinkedInSlug(slug)).toBe(display);
  });
});
