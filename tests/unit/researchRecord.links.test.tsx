// @vitest-environment jsdom
// =============================================================================
// Unit: research citations become links only when they are web addresses
// =============================================================================
// The dossier's Research card links every page a run cited, and each fact to
// the page behind it. Those addresses come from a provider, so a
// `javascript:` or `data:` address must never reach an anchor. The record
// keeps only absolute http and https addresses, and one bad address costs
// only itself: a stored record still reads, with the bad source dropped and a
// finding's bad address read as none. The card sends each address through
// `safeHref` as well, like every other external link in the app.
// =============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../src/contexts/AISearchContext", async (original) => ({
  isEnriching: (
    await original<typeof import("../../src/contexts/AISearchContext")>()
  ).isEnriching,
  useAISearch: () => null,
  useOptionalAISearch: () => null,
}));
vi.mock("../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => false,
}));

import {
  isWebUrl,
  parseResearchRecord,
  researchRecordSchema,
} from "../../shared/researchRecord";
import { ResearchCard } from "../../src/views/contact-detail/components/ResearchCard";
import type { Contact } from "../../src/types";

afterEach(cleanup);

const AT = "2026-09-26T22:00:00.000Z";

/** A stored record with one run, these findings and these sources. */
function record(
  findings: Array<Record<string, unknown>>,
  sources: Array<Record<string, unknown>>,
) {
  return {
    version: 1,
    runs: [
      {
        at: AT,
        models: ["gemini-3.8-flash"],
        outcome: "added",
        added: [],
        sourceCount: sources.length,
        queries: [],
        findings,
      },
    ],
    sources,
  };
}

const GOOD = {
  url: "https://fellows.example.org/people/rowan-vale",
  title: "Rowan Vale, Fellow",
  firstSeenAt: AT,
};

describe("isWebUrl", () => {
  it("accepts absolute http and https addresses only", () => {
    expect(isWebUrl("https://example.org/a")).toBe(true);
    expect(isWebUrl("HTTP://example.org")).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<b>hi</b>",
      "vbscript:msgbox",
      "mailto:rowan@example.org",
      "/people/rowan",
      "//example.org/a",
      "example.org",
      "https://",
      "",
    ]) {
      expect(isWebUrl(bad), bad).toBe(false);
    }
  });
});

describe("reading a stored record", () => {
  it("drops a source with a bad address, and keeps the record and the rest", () => {
    const parsed = parseResearchRecord(
      JSON.stringify(
        record(
          [],
          [
            { url: "javascript:alert(1)", title: "Bad", firstSeenAt: AT },
            GOOD,
            { url: "/relative/page", title: "Relative", firstSeenAt: AT },
          ],
        ),
      ),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.runs).toHaveLength(1);
    expect(parsed!.sources).toEqual([GOOD]);
  });

  it("reads a finding's bad address as none, and keeps the fact", () => {
    const parsed = parseResearchRecord(
      record(
        [
          {
            topic: "Role",
            text: "Associate, Northwind Partners",
            site: "example.org",
            url: "data:text/html,<script>alert(1)</script>",
          },
          {
            topic: "School",
            text: "BA, University of Example",
            url: GOOD.url,
          },
        ],
        [GOOD],
      ),
    );
    const [role, school] = parsed!.runs[0].findings;
    expect(role.text).toBe("Associate, Northwind Partners");
    expect(role.site).toBe("example.org");
    expect(role.url).toBeUndefined();
    expect(school.url).toBe(GOOD.url);
  });

  it("still reads no record when the record itself is broken", () => {
    expect(parseResearchRecord({ version: 1, runs: "nope" })).toBeNull();
    expect(parseResearchRecord("{not json")).toBeNull();
  });
});

describe("writing a record", () => {
  it("validates a run that cited a bad address, and stores it without that page", () => {
    // What the enrichment merge checks before it saves: the history plus the
    // new run's citations, one of them not a web page.
    const checked = researchRecordSchema.safeParse(
      record(
        [{ topic: "Role", text: "Associate", url: "javascript:void(0)" }],
        [GOOD, { url: "javascript:void(0)", title: "x", firstSeenAt: AT }],
      ),
    );
    expect(checked.success).toBe(true);
    const stored = JSON.parse(JSON.stringify(checked.data));
    expect(stored.sources).toEqual([GOOD]);
    expect(stored.runs[0].findings[0]).toEqual({
      topic: "Role",
      text: "Associate",
    });
  });
});

describe("the Research card", () => {
  it("links only web addresses, even from a record with bad ones", () => {
    const contact = {
      id: "c1",
      name: "Rowan Vale",
      emails: [],
      addresses: [],
      socialLinks: [],
      education: [],
      aiHydratedAt: AT,
      aiResearch: JSON.stringify(
        record(
          [
            {
              topic: "Role",
              text: "Fellow at the Example Society",
              site: "fellows.example.org",
              url: "javascript:alert(document.cookie)",
            },
          ],
          [
            { url: "javascript:alert(1)", title: "Bad page", firstSeenAt: AT },
            GOOD,
          ],
        ),
      ),
    } as unknown as Contact;

    const { container } = render(<ResearchCard contact={contact} />);

    // The fact still shows, linked to the page its site names.
    expect(screen.getByText(/Fellow at the Example Society/)).toBeTruthy();
    expect(screen.queryByText("Bad page")).toBeNull();

    const hrefs = Array.from(container.querySelectorAll("a")).map((anchor) =>
      anchor.getAttribute("href"),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^https:\/\//);
    expect(hrefs).toContain(GOOD.url);
  });
});
