// @vitest-environment jsdom
// StartPanel: the pane beside the list when no contact is open. It shows the
// mark and the words "No contact selected", and nothing else. With nobody in
// the network it shows nothing, because the list's own empty state has the
// bird.
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StartPanel } from "../../../../src/components/layout/StartPanel";

afterEach(() => {
  cleanup();
});

const renderWith = (contacts: unknown[]) => {
  const client = new QueryClient();
  client.setQueryData(["contacts"], contacts);
  return render(
    <QueryClientProvider client={client}>
      <StartPanel />
    </QueryClientProvider>,
  );
};

describe("StartPanel", () => {
  it("shows the mark and says once that no contact is selected", () => {
    const { container } = renderWith([{ id: "c1", name: "Rowan Vale" }]);
    expect(
      screen.getByRole("heading", { level: 2, name: "No contact selected" }),
    ).toBeTruthy();
    const mark = container.querySelector("svg");
    // Decorative: the heading beside it says what the pane is.
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent?.trim()).toBe("No contact selected");
  });

  it("draws no second bird beside an empty network", () => {
    const { container } = renderWith([]);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
