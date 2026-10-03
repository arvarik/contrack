// @vitest-environment jsdom
/**
 * ChoiceGroup: one choice from a few, as a radio group of tiles.
 *
 * The roles, the one Tab stop, the arrow keys, the tint and the dot, and the
 * two ways a group waits: while a change saves, and for good when the
 * environment sets the value.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChoiceGroup } from "../../../../src/components/ui/ChoiceGroup";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days", hint: "Default" },
  { value: 90, label: "90 days" },
] as const;

function mount(props: Partial<React.ComponentProps<typeof ChoiceGroup>> = {}) {
  const onChange = vi.fn();
  render(
    <ChoiceGroup
      label="Trash"
      value={30}
      options={OPTIONS}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

describe("ChoiceGroup", () => {
  it("is a named radio group with one Tab stop, on the chosen tile", () => {
    mount();
    expect(screen.getByRole("radiogroup", { name: "Trash" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByText("Default")).toBeTruthy();
  });

  it("makes the first tile the Tab stop when the value matches none", () => {
    mount({ value: 45 });
    expect(screen.getAllByRole("radio").map((radio) => radio.tabIndex)).toEqual(
      [0, -1, -1],
    );
  });

  it("chooses on a press and on an arrow key, and not again on the chosen tile", () => {
    const onChange = mount();
    fireEvent.click(screen.getByRole("radio", { name: /30 days/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /90 days/ }));
    expect(onChange).toHaveBeenLastCalledWith(90);
    fireEvent.keyDown(screen.getByRole("radio", { name: /30 days/ }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenLastCalledWith(7);
  });

  it("waits while a change saves, and keeps its focus", () => {
    const onChange = mount({ pending: true });
    const tile = screen.getByRole("radio", { name: /90 days/ });
    expect(tile.getAttribute("aria-disabled")).toBe("true");
    expect(tile.hasAttribute("disabled")).toBe(false);
    fireEvent.click(tile);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a value the environment sets, dimmed, and does not change it", () => {
    const onChange = mount({ locked: true });
    const tile = screen.getByRole("radio", { name: /7 days/ });
    expect(tile.className).toContain("opacity-75");
    fireEvent.click(tile);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a tile that cannot be chosen now, dimmed, says why, and skips it", () => {
    const onChange = vi.fn();
    render(
      <ChoiceGroup
        label="Web search engine"
        value="provider"
        options={[
          { value: "provider", label: "Gemini" },
          {
            value: "searxng",
            label: "SearXNG",
            hint: "Needs a SearXNG address",
            disabled: true,
          },
          { value: "combined", label: "Both" },
        ]}
        onChange={onChange}
      />,
    );
    const searxng = screen.getByRole("radio", { name: /SearXNG/ });
    expect(searxng.getAttribute("aria-disabled")).toBe("true");
    expect(searxng.textContent).toContain("Needs a SearXNG address");
    fireEvent.click(searxng);
    expect(onChange).not.toHaveBeenCalled();
    // The arrow keys pass over it.
    fireEvent.keyDown(screen.getByRole("radio", { name: "Gemini" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith("combined");
  });

  it("lets the arrow keys leave a chosen tile that cannot be chosen now", () => {
    const onChange = vi.fn();
    render(
      <ChoiceGroup
        label="Web search engine"
        value="searxng"
        options={[
          { value: "provider", label: "Gemini" },
          { value: "searxng", label: "SearXNG", disabled: true },
        ]}
        onChange={onChange}
      />,
    );
    const searxng = screen.getByRole("radio", { name: "SearXNG" });
    expect(searxng.tabIndex).toBe(0);
    fireEvent.keyDown(searxng, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("provider");
  });
});
