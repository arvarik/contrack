// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DossierTab } from "../../src/views/contact-detail/components/DossierTab";
import { MemoryRouter } from "react-router-dom";
import { THINKING_CLASS } from "../../src/components/brand/CorvidThinking";
import type { Contact } from "../../src/types";
afterEach(cleanup);
/** A research record with two runs, as the enrichment merge writes it. */
const RECORD = JSON.stringify({
  version: 1,
  runs: [
    {
      at: "2026-09-26T22:00:00.000Z",
      models: [],
      outcome: "added",
      added: [],
      sourceCount: 0,
      queries: [],
      findings: [],
    },
    {
      at: "2026-09-26T23:00:00.000Z",
      models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
      outcome: "added",
      added: [
        { field: "experience", count: 2 },
        { field: "location", count: 1 },
      ],
      sourceCount: 2,
      queries: [],
      findings: [
        {
          topic: "Past role",
          text: "Associate, Harbor Point Partners, 2018 to 2020",
          site: "finra.org",
        },
        {
          topic: "Award",
          text: "Distinguished Fellow",
          url: "https://fellows.example.org/people/rowan-vale",
        },
      ],
    },
  ],
  sources: [
    {
      url: "https://brokercheck.finra.org/individual/summary/1234567",
      title: "finra.org",
      firstSeenAt: "2026-09-26T23:00:00.000Z",
    },
    {
      url: "https://fellows.example.org/people/rowan-vale",
      title: "Rowan Vale, Fellows Program",
      firstSeenAt: "2026-09-26T23:00:00.000Z",
    },
  ],
});

describe("the Research card", () => {
  it("comes last, after the details it says the source of", () => {
    const { container } = render(
      <DossierTab
        contact={
          {
            id: "test",
            name: "Test",
            about: "Banker in New York",
            aiResearch: RECORD,
            experience: [
              { id: "e1", company: "Northwind Partners", role: "Associate" },
            ],
          } as Contact
        }
      />,
    );
    const headings = [...container.querySelectorAll("h2, h3")].map((heading) =>
      heading.textContent?.trim(),
    );
    expect(headings.at(-4)).toBe("Research");
    // The old card sat between About and Experience, closed, with its own
    // scroll. It is gone.
    expect(screen.queryByText("Research notes and sources")).toBeNull();
  });

  it("lists each run, what the latest found beside its page, and every page", () => {
    render(
      <DossierTab
        contact={{ id: "test", name: "Test", aiResearch: RECORD } as Contact}
      />,
    );
    expect(
      screen.getByText(/^Enriched 2 times · last .* ago · 2 web pages$/),
    ).toBeTruthy();
    expect(
      screen.getByText("Enriched before details were recorded"),
    ).toBeTruthy();
    expect(
      screen.getByText("Added 3 from 2 pages: Roles ×2, Location"),
    ).toBeTruthy();
    expect(screen.getByText("Gemini 3.8 Flash")).toBeTruthy();

    // The finding names finra.org; the link opens the page that matched it.
    const finding = screen.getByText(
      "Associate, Harbor Point Partners, 2018 to 2020",
    );
    const link = finding.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(
      "https://brokercheck.finra.org/individual/summary/1234567",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // A fact with no site of its own links to the page the provider matched.
    expect(
      screen
        .getByText("Distinguished Fellow")
        .querySelector("a")
        ?.getAttribute("href"),
    ).toBe("https://fellows.example.org/people/rowan-vale");

    // A page Gemini named by its domain shows its address; a titled page
    // shows its title.
    expect(
      screen.getByText(
        "brokercheck.finra.org › individual › summary › 1234567",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Rowan Vale, Fellows Program")).toBeTruthy();
    expect(screen.getByText("Sources")).toBeTruthy();
  });

  it("says the old dossier kept no pages, and does not show its copy of the cards", () => {
    render(
      <DossierTab
        contact={
          {
            id: "test",
            name: "Test",
            aiHydratedAt: "2026-09-26T22:21:58.046Z",
            aiBackground:
              "Copied about.\n\n### Sources\n- [Source 1](<https://vertexaisearch.cloud.google.com/grounding-api-redirect/X>)",
          } as Contact
        }
      />,
    );
    expect(screen.getByText(/kept no list of the pages it read/)).toBeTruthy();
    expect(screen.queryByText("Copied about.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Source 1" })).toBeNull();
  });

  it("shows notes from elsewhere as they were written, and opens their links outside the app", () => {
    render(
      <DossierTab
        contact={
          {
            id: "test",
            name: "Test",
            aiBackground:
              "Research notes.\n\n[Source](https://example.com/research)",
          } as Contact
        }
      />,
    );
    expect(screen.getByText("Research notes")).toBeTruthy();
    const source = screen.getByRole("link", { name: "Source", hidden: true });
    expect(source.getAttribute("href")).toBe("https://example.com/research");
    expect(source.getAttribute("rel")).toBe("noopener noreferrer");
    expect(source.getAttribute("target")).toBe("_blank");
  });

  it("blocks embedded HTML, remote images, and unsafe source schemes", () => {
    const { container } = render(
      <DossierTab
        contact={
          {
            id: "test",
            name: "Test",
            aiBackground:
              "<script>alert(1)</script>\n\n![tracking](https://example.com/image)\n\n[Unsafe](javascript:alert(1))",
          } as Contact
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The briefing card while it is being written
// ---------------------------------------------------------------------------

/** A contact with nothing in it, so the card offers to write a briefing. */
const BLANK = { id: "test", name: "Test" } as Contact;

/** The card links to the contact's other tabs, so it needs a router. */
const renderCard = (isPending: boolean) =>
  render(
    <MemoryRouter>
      <DossierTab
        contact={BLANK}
        generateBriefing={{ mutate: () => {}, isPending }}
      />
    </MemoryRouter>,
  );

describe("the briefing card while it writes", () => {
  it("says what it is doing, and shows the bird beside the sentence", () => {
    const { container } = renderCard(true);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Writing the briefing…");
    // The bird is beside the live region, never inside it: a named image in
    // a `role="status"` would be read out with every announcement.
    expect(status.querySelector("svg")).toBeNull();
    const bird = container.querySelector(`svg.${THINKING_CLASS}`);
    expect(bird).toBeTruthy();
    expect(bird!.getAttribute("aria-hidden")).toBe("true");
  });

  it("leaves no gap under the card when nothing is pending", () => {
    // The row always holds the `<p>`, so `:empty` can never match it and
    // `empty:mt-0` would leave 12 px of nothing below the briefing for the
    // whole life of the card.
    const { container } = renderCard(false);
    const row = container.querySelector('[role="status"]')!.parentElement!;
    expect(row.className).not.toContain("mt-3");
    expect(container.querySelector("svg." + THINKING_CLASS)).toBeNull();
  });

  it("puts the gap back while it is writing", () => {
    const { container } = renderCard(true);
    const row = container.querySelector('[role="status"]')!.parentElement!;
    expect(row.className).toContain("mt-3");
  });
});
