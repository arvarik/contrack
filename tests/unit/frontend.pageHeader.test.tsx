// @vitest-environment jsdom
/**
 * The one page header.
 *
 * Every page's top is `PageHeader`, so its promises are the ones every page
 * makes: one heading for the page, a line under it, the actions beside it,
 * and one set of sizes. Pulse keeps its day as the headline, and the Network
 * list steps down to an h2 when a contact is open beside it.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageHeader } from "../../src/components/layout/PageHeader";
import {
  PAGE_DESCRIPTION,
  PAGE_EYEBROW,
  PAGE_TITLE,
} from "../../src/lib/styles";

afterEach(() => {
  cleanup();
});

const renderHeader = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("PageHeader", () => {
  it("renders the title as the page's h1 in the title type", () => {
    renderHeader(<PageHeader title="Network" />);
    const heading = screen.getByRole("heading", { level: 1, name: "Network" });
    expect(heading.className).toContain(PAGE_TITLE);
  });

  it("puts the description under the title and the actions beside it", () => {
    renderHeader(
      <PageHeader
        title="Ask Contrack"
        description="Ask a question about your network in plain words"
        actions={<button type="button">History</button>}
      />,
    );
    const description = screen.getByText(
      "Ask a question about your network in plain words",
    );
    expect(description.tagName).toBe("P");
    expect(description.className).toContain(PAGE_DESCRIPTION);
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
  });

  it("makes the eyebrow the h1 when the title is a headline", () => {
    renderHeader(
      <PageHeader
        eyebrow="Pulse"
        eyebrowAs="h1"
        title="Tuesday, September 22"
        titleAs="p"
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Pulse" });
    expect(heading.className).toContain(PAGE_EYEBROW);
    const date = screen.getByText("Tuesday, September 22");
    expect(date.tagName).toBe("P");
    expect(date.className).toContain(PAGE_TITLE);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("steps the title down to an h2 when the page has another h1", () => {
    renderHeader(<PageHeader title="Network" titleAs="h2" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Network" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("draws a back link above the title", () => {
    renderHeader(
      <PageHeader
        back={{ to: "/pulse", label: "Pulse" }}
        title="Possible duplicates"
      />,
    );
    const link = screen.getByRole("link", { name: "Back to Pulse" });
    expect(link.textContent).toBe("Pulse");
    expect(link.getAttribute("href")).toBe("/pulse");
    expect(link.className).toContain("hit-area");
  });

  it("renders children under the title block", () => {
    renderHeader(
      <PageHeader title="Network">
        <input aria-label="Search contacts" />
      </PageHeader>,
    );
    expect(
      screen.getByRole("textbox", { name: "Search contacts" }),
    ).toBeTruthy();
  });

  it("draws no band, border or icon tile", () => {
    const { container } = renderHeader(
      <PageHeader title="Settings" description="One page per job" />,
    );
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.className).not.toMatch(/\bbg-|\bborder/);
    expect(container.querySelector("svg")).toBeNull();
  });
});
