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
  it.each([
    // A numeric auto-generated suffix
    ["rowan-vale-07993773", "rowan-vale"],
    // A hex auto-generated suffix
    ["ellis-harbor-17b821a8", "ellis-harbor"],
    // The suffix goes, the short name initial stays
    ["mira-jonah-c-027b18156", "mira-jonah-c"],
    // A mixed alphanumeric suffix
    ["tobin-ash-78ab07111", "tobin-ash"],
    // Custom usernames without hyphens stay, digits and all
    ["rowanv1196", "rowanv1196"],
    ["northwind05104", "northwind05104"],
    // A short name segment without digits stays
    ["jane-doe", "jane-doe"],
  ])("shows %j as %j", (slug, display) => {
    expect(cleanLinkedInSlug(slug)).toBe(display);
  });
});
