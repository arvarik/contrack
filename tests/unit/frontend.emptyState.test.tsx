// @vitest-environment jsdom
/**
 * The one empty state.
 *
 * Every screen with nothing to show renders this primitive, so its promises
 * are the ones every such screen makes: a heading at the right level, one
 * sentence, and at most one action, drawn as the app's primary button.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Users, Upload } from "lucide-react";
import { EmptyState } from "../../src/components/ui/EmptyState";

afterEach(() => {
  cleanup();
});

describe("EmptyState", () => {
  it("renders the title as an h2 by default", () => {
    render(
      <EmptyState
        icon={Users}
        title="Your network is empty"
        body="Bring in the people you already have, or add one by hand."
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Your network is empty" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Bring in the people you already have, or add one by hand.",
      ),
    ).toBeTruthy();
  });

  it("renders an h3 inside a card", () => {
    render(
      <section aria-labelledby="card-title">
        <h2 id="card-title">AI usage</h2>
        <EmptyState
          level={3}
          title="No AI activity yet"
          body="Briefings, searches and scans show up here."
        />
      </section>,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "No AI activity yet" }),
    ).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(1);
  });

  it("renders no button without an action", () => {
    render(<EmptyState title="Trash is empty" body="Nothing here." />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders one action as the primary button and calls it", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={Users}
        title="Your network is empty"
        body="Bring in the people you already have."
        action={{ label: "Import", onClick, icon: Upload }}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    const button = screen.getByRole("button", { name: "Import" });
    expect(button.className).toContain("btn-primary");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("draws the icon in a tile, and the illustration in its place", () => {
    const { rerender } = render(
      <EmptyState icon={Users} title="Title" body="Body." />,
    );
    expect(screen.getByTestId("empty-state-icon")).toBeTruthy();

    rerender(
      <EmptyState
        icon={Users}
        illustration={<svg data-testid="corvid" aria-hidden="true" />}
        title="Title"
        body="Body."
      />,
    );
    expect(screen.queryByTestId("empty-state-icon")).toBeNull();
    expect(screen.getByTestId("corvid")).toBeTruthy();
  });
});
