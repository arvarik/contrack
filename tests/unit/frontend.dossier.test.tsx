// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DossierTab } from "../../src/views/contact-detail/components/DossierTab";
import { MemoryRouter } from "react-router-dom";
import { THINKING_CLASS } from "../../src/components/brand/CorvidThinking";
import type { Contact } from "../../src/types";
afterEach(cleanup);
describe("research notes", () => {
  it("shows research-only dossiers and opens sources without replacing the app", () => {
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
    expect(screen.getByText("Research notes and sources")).toBeTruthy();
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
