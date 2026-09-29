// @vitest-environment jsdom
// =============================================================================
// The palette's facet autocomplete offers contacted:
// =============================================================================
// `contacted:` is the newest facet. Its values are presets, like score: and
// updated:, and each one picks a filter the server and the palette read the
// same way: within 30 days, over 90 days ago or never, and never.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FacetAutocomplete } from "../../../../src/components/command-palette/FacetAutocomplete";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The labels, without the field name each row starts with. */
const labels = () =>
  screen
    .getAllByRole("button")
    .map((button) => button.textContent?.replace(/^contacted:/, ""));

function show(partial: string) {
  // The presets need no contacts. The slim list is asked for all the same.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
  const onSelect = vi.fn();
  render(
    <FacetAutocomplete
      field="contacted"
      partial={partial}
      onSelect={onSelect}
      onDismiss={() => {}}
    />,
    { wrapper },
  );
  return onSelect;
}

describe("contacted: in the facet autocomplete", () => {
  it("offers the three presets", () => {
    show("");
    expect(labels()).toEqual([
      "Within 30 days",
      "Over 90 days ago, or never",
      "Never",
    ]);
  });

  it.each([
    ["Within 30 days", { field: "contacted", value: "30d", operator: "<" }],
    [
      "Over 90 days ago, or never",
      { field: "contacted", value: "90d", operator: ">" },
    ],
    ["Never", { field: "contacted", value: "never" }],
  ])("picks %s as its filter", (label, filter) => {
    const onSelect = show("");
    fireEvent.click(screen.getByRole("button", { name: `contacted:${label}` }));
    expect(onSelect).toHaveBeenCalledWith(filter);
  });

  it("narrows the presets to what was typed", () => {
    show("nev");
    expect(labels()).toEqual(["Over 90 days ago, or never", "Never"]);
  });
});
