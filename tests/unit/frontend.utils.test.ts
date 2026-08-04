import { describe, it, expect } from "vitest";
import { safeHref, escapeHtml, cleanLinkedInSlug } from "../../src/lib/utils";

describe("safeHref", () => {
  it("allows http URLs", () => {
    expect(safeHref("http://example.com")).toBe("http://example.com");
  });

  it("allows https URLs", () => {
    expect(safeHref("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("allows mailto URLs", () => {
    expect(safeHref("mailto:jane@example.com")).toBe("mailto:jane@example.com");
  });

  it("allows tel URLs", () => {
    expect(safeHref("tel:+15551234567")).toBe("tel:+15551234567");
  });

  it("allows relative paths starting with /", () => {
    expect(safeHref("/uploads/file.pdf")).toBe("/uploads/file.pdf");
  });

  it("rejects javascript: URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects javascript: URLs with mixed case and whitespace", () => {
    expect(safeHref("  JaVaScRiPt:alert(1)")).toBeUndefined();
  });

  it("rejects data: URLs", () => {
    expect(
      safeHref("data:text/html,<script>alert(1)</script>"),
    ).toBeUndefined();
  });

  it("rejects vbscript: URLs", () => {
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
  });

  it("rejects bare strings that are not URLs or rooted paths", () => {
    expect(safeHref("example.com")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
  });

  it("returns undefined for null, undefined, and empty input", () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
    expect(safeHref("   ")).toBeUndefined();
  });
});

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes double and single quotes", () => {
    expect(escapeHtml(`He said "hi" and 'bye'`)).toBe(
      "He said &quot;hi&quot; and &#39;bye&#39;",
    );
  });

  it("escapes an attribute-breaking payload", () => {
    expect(escapeHtml(`" onerror="alert(1)`)).toBe(
      "&quot; onerror=&quot;alert(1)",
    );
  });

  it("escapes & before other entities (no double escaping artifacts)", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("https://example.com/avatar.png")).toBe(
      "https://example.com/avatar.png",
    );
  });
});

describe("cleanLinkedInSlug", () => {
  // The six documented examples from the original heuristic.
  it("strips a numeric auto-generated suffix", () => {
    expect(cleanLinkedInSlug("alex-sadler-07993773")).toBe("alex-sadler");
  });

  it("strips a hex auto-generated suffix", () => {
    expect(cleanLinkedInSlug("alexander-glavin-17b821a8")).toBe(
      "alexander-glavin",
    );
  });

  it("strips the suffix while keeping short name initials", () => {
    expect(cleanLinkedInSlug("yuxuan-jonathan-c-027b18156")).toBe(
      "yuxuan-jonathan-c",
    );
  });

  it("strips a mixed alphanumeric suffix", () => {
    expect(cleanLinkedInSlug("young-lee-78ab07111")).toBe("young-lee");
  });

  it("leaves custom usernames without hyphens untouched", () => {
    expect(cleanLinkedInSlug("aayush1196")).toBe("aayush1196");
  });

  it("leaves digit-containing usernames without hyphens untouched", () => {
    expect(cleanLinkedInSlug("wangxi05104")).toBe("wangxi05104");
  });

  it("does not strip short name segments without digits", () => {
    expect(cleanLinkedInSlug("jane-doe")).toBe("jane-doe");
  });
});
