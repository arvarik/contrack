// @vitest-environment jsdom
/**
 * The contact list's roving Tab stop, and the letter rail beside it.
 *
 * The list is one stop in the Tab order, and the keys inside it do what a
 * list's keys do. Rendered with plain buttons so the test exercises the hook
 * and not the virtualiser: a list that only mounts some rows is simulated by
 * the `mounted` range below.
 */
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useRovingList } from "../../src/views/contact-list/useRovingList";
import { AlphabetRail } from "../../src/views/contact-list/AlphabetRail";

afterEach(() => {
  cleanup();
});

const NAMES = [
  "Ada Lovelace",
  "Alan Turing",
  "Edsger Dijkstra",
  "Grace Hopper",
];

function List({
  onOpen,
  selectedIndex = -1,
  mountedFrom = 0,
  generation = 0,
}: {
  onOpen?: (index: number) => void;
  selectedIndex?: number;
  /** Rows before this index are "scrolled out" and not rendered. */
  mountedFrom?: number;
  /** A new value remounts every row, the way a virtualiser re-measure can. */
  generation?: number;
}) {
  const [firstMounted, setFirstMounted] = useState(mountedFrom);
  const roving = useRovingList({
    count: NAMES.length,
    selectedIndex,
    getLabel: (index) => NAMES[index],
    getElement: (index) => document.getElementById(`row-${index}`),
    scrollToIndex: (index) =>
      setFirstMounted((first) => Math.min(first, index)),
    isRendered: (index) => index >= firstMounted,
    onOpen,
  });
  return (
    <div data-testid="scroller" {...roving.containerProps}>
      {NAMES.map((name, index) =>
        index >= firstMounted ? (
          <button
            key={`${name}-${generation}`}
            id={`row-${index}`}
            {...roving.getItemProps(index)}
          >
            {name}
          </button>
        ) : null,
      )}
    </div>
  );
}

const row = (name: string) => screen.getByRole("button", { name });
const tabStops = () =>
  screen.queryAllByRole("button").filter((b) => b.tabIndex === 0);

describe("useRovingList", () => {
  it("puts exactly one row in the Tab order", () => {
    render(<List />);
    expect(tabStops()).toEqual([row("Ada Lovelace")]);
    expect(screen.getByTestId("scroller").hasAttribute("tabindex")).toBe(false);
  });

  it("moves focus and the Tab stop with the arrow keys, clamped at the ends", () => {
    render(<List />);
    act(() => row("Ada Lovelace").focus());

    fireEvent.keyDown(row("Ada Lovelace"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("Alan Turing"));
    expect(tabStops()).toEqual([row("Alan Turing")]);

    fireEvent.keyDown(row("Alan Turing"), { key: "ArrowUp" });
    fireEvent.keyDown(row("Ada Lovelace"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("Ada Lovelace"));
  });

  it("jumps to the first and last rows with Home and End", () => {
    render(<List />);
    act(() => row("Ada Lovelace").focus());

    fireEvent.keyDown(row("Ada Lovelace"), { key: "End" });
    expect(document.activeElement).toBe(row("Grace Hopper"));

    fireEvent.keyDown(row("Grace Hopper"), { key: "Home" });
    expect(document.activeElement).toBe(row("Ada Lovelace"));
  });

  it("jumps by first letter, and the same letter again walks through the matches", () => {
    render(<List />);
    act(() => row("Ada Lovelace").focus());

    fireEvent.keyDown(row("Ada Lovelace"), { key: "g" });
    expect(document.activeElement).toBe(row("Grace Hopper"));

    fireEvent.keyDown(row("Grace Hopper"), { key: "A" });
    expect(document.activeElement).toBe(row("Ada Lovelace"));
    fireEvent.keyDown(row("Ada Lovelace"), { key: "a" });
    expect(document.activeElement).toBe(row("Alan Turing"));
  });

  it("consumes a letter with no match so it cannot reach a page shortcut", () => {
    render(<List />);
    act(() => row("Ada Lovelace").focus());
    const allowed = fireEvent.keyDown(row("Ada Lovelace"), { key: "z" });
    expect(allowed).toBe(false);
    expect(document.activeElement).toBe(row("Ada Lovelace"));
  });

  it("leaves modified keys alone", () => {
    render(<List />);
    act(() => row("Ada Lovelace").focus());
    const allowed = fireEvent.keyDown(row("Ada Lovelace"), {
      key: "g",
      metaKey: true,
    });
    expect(allowed).toBe(true);
    expect(document.activeElement).toBe(row("Ada Lovelace"));
  });

  it("opens the focused row with Enter", () => {
    const onOpen = vi.fn();
    render(<List onOpen={onOpen} />);
    act(() => row("Ada Lovelace").focus());
    fireEvent.keyDown(row("Ada Lovelace"), { key: "ArrowDown" });
    fireEvent.keyDown(row("Alan Turing"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("follows the selection, so Tab back into the list lands on the open row", () => {
    const { rerender } = render(<List selectedIndex={-1} />);
    expect(tabStops()).toEqual([row("Ada Lovelace")]);
    rerender(<List selectedIndex={2} />);
    expect(tabStops()).toEqual([row("Edsger Dijkstra")]);
  });

  it("takes a focused row as the new Tab stop, however focus got there", () => {
    render(<List />);
    act(() => row("Grace Hopper").focus());
    expect(tabStops()).toEqual([row("Grace Hopper")]);
  });

  it("keeps the Tab stop on the list while the active row is scrolled out, and hands focus to it", async () => {
    render(<List mountedFrom={2} />);
    const scroller = screen.getByTestId("scroller");
    // Row 0 owns the Tab stop but is not mounted, so the scroller holds it.
    expect(scroller.getAttribute("tabindex")).toBe("0");

    act(() => scroller.focus());
    // The row mounts on the next render, and the hook focuses it on the
    // frame after that, the way a virtualiser would bring it in.
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    // Focusing the scroller scrolled row 0 back in and moved focus onto it.
    expect(document.activeElement).toBe(row("Ada Lovelace"));
    expect(scroller.hasAttribute("tabindex")).toBe(false);
  });

  it("lets go once the person moves focus away, even on the next frame", async () => {
    render(
      <>
        <List />
        <button type="button">Outside</button>
      </>,
    );
    act(() => row("Ada Lovelace").focus());
    fireEvent.keyDown(row("Ada Lovelace"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("Alan Turing"));

    // Enter opened the contact and focus went to its name before a frame
    // passed. The hook must not pull focus back to the row.
    const outside = screen.getByRole("button", { name: "Outside" });
    act(() => outside.focus());
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(document.activeElement).toBe(outside);
  });

  it("puts focus back when the row is remounted under it a frame later", async () => {
    const { rerender } = render(<List mountedFrom={2} />);
    act(() => screen.getByTestId("scroller").focus());
    const nextFrame = () =>
      act(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    await nextFrame();
    expect(document.activeElement).toBe(row("Ada Lovelace"));

    // The virtualiser re-measures and replaces the row element: focus falls
    // to the document, and the hook is still holding on, so it refocuses.
    rerender(<List mountedFrom={2} generation={1} />);
    expect(document.activeElement).toBe(document.body);
    await nextFrame();
    expect(document.activeElement).toBe(row("Ada Lovelace"));
  });
});

/**
 * The letter rail is the same idea at a smaller scale: one Tab stop, arrows
 * inside, and only the letters that lead somewhere.
 */
describe("AlphabetRail", () => {
  const index = new Map([
    ["A", 0],
    ["E", 2],
    ["G", 3],
    ["#", 5],
  ]);

  const rail = () => screen.getByRole("group", { name: "Jump to letter" });
  const letter = (name: string) => within(rail()).getByRole("button", { name });

  it("renders only the letters with contacts, with one Tab stop", () => {
    render(<AlphabetRail index={index} activeBucket="E" onJump={() => {}} />);
    const buttons = within(rail()).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["A", "E", "G", "#"]);
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([letter("E")]);
    expect(letter("E").getAttribute("aria-current")).toBe("true");
    expect(letter("# (other characters)")).toBeTruthy();
  });

  it("moves between letters with the arrow keys and jumps the list as it goes", () => {
    const onJump = vi.fn();
    render(<AlphabetRail index={index} activeBucket="A" onJump={onJump} />);
    act(() => letter("A").focus());

    fireEvent.keyDown(letter("A"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(letter("E"));
    expect(onJump).toHaveBeenLastCalledWith(2);

    fireEvent.keyDown(letter("E"), { key: "End" });
    expect(document.activeElement).toBe(letter("# (other characters)"));
    expect(onJump).toHaveBeenLastCalledWith(5);

    fireEvent.keyDown(letter("# (other characters)"), { key: "g" });
    expect(document.activeElement).toBe(letter("G"));
    expect(onJump).toHaveBeenLastCalledWith(3);
  });

  it("jumps on Enter, through the button's own click", () => {
    const onJump = vi.fn();
    render(<AlphabetRail index={index} activeBucket="A" onJump={onJump} />);
    fireEvent.click(letter("G"));
    expect(onJump).toHaveBeenCalledWith(3);
  });
});
