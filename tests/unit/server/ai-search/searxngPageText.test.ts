// Unit: pageText — what research reads from a fetched page
// Research parses with cheerio/slim (htmlparser2). Unlike the full build
// (parse5), it adds no <body> to a fragment or a text/plain answer, so these
// cases pin the fallback that reads the whole document instead.

import { describe, it, expect } from "vitest";
import { pageText } from "../../../../server/services/research/pages.ts";

describe("pageText", () => {
  it("reads the body without scripts or page chrome", () => {
    const html =
      "<html><head><title>T</title><script>track()</script></head>" +
      "<body><nav>menu</nav><p>Jane Doe is the CTO of Acme.</p>" +
      "<footer>© Acme</footer></body></html>";
    expect(pageText(html)).toBe("Jane Doe is the CTO of Acme.");
  });

  it("reads a fragment that has no body element", () => {
    const html = "<title>Profile</title><p>Jane Doe joined Acme in 2024.</p>";
    expect(pageText(html)).toBe("Jane Doe joined Acme in 2024.");
  });

  it("reads a text/plain answer", () => {
    expect(pageText("Jane Doe, CTO at Acme\nSan Francisco")).toBe(
      "Jane Doe, CTO at Acme San Francisco",
    );
  });

  it("returns null for a page with no text", () => {
    expect(pageText("<html><body><script>x()</script></body></html>")).toBe(
      null,
    );
  });

  it("cuts a long page to 6,000 characters", () => {
    const text = pageText(`<body><p>${"word ".repeat(3000)}</p></body>`);
    expect(text?.length).toBe(6000);
  });
});
