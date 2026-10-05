// @vitest-environment jsdom
// `contacted:` takes presets, like score: and updated:, each a filter the
// server and the palette read the same way.
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
  it("offers three presets, narrows them to what was typed, and picks one", () => {
    show("");
    expect(labels()).toEqual([
      "Within 30 days",
      "Over 90 days ago, or never",
      "Never",
    ]);
    cleanup();

    const onSelect = show("nev");
    expect(labels()).toEqual(["Over 90 days ago, or never", "Never"]);
    fireEvent.click(screen.getByRole("button", { name: "contacted:Never" }));
    expect(onSelect).toHaveBeenCalledWith({
      field: "contacted",
      value: "never",
    });
  });
});
