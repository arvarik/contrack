// @vitest-environment jsdom
/**
 * useContactListKeyboard: the arrows and j/k walk the list from the open
 * contact. The listener is attached once and reads the latest values from a
 * ref written in the commit, so a key pressed as soon as the page shows a
 * new current row steps from that row. It used to be attached again in an
 * effect after every change, and a fast second ArrowDown ran the listener
 * from before and reopened the row that was already open.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useContactListKeyboard } from "../../src/views/contact-list/hooks/useContactListKeyboard";
import type { Contact } from "../../src/types";

vi.mock("../../src/hooks/useSingleKeyShortcuts", () => ({
  useSingleKeyShortcuts: () => true,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const people = ["ada", "edsger", "grace"].map(
  (id) => ({ id, name: id }) as unknown as Contact,
);

const Harness = ({
  currentId,
  navigate,
}: {
  currentId: string | undefined;
  navigate: (path: string) => void;
}) => {
  useContactListKeyboard({
    filteredContacts: people,
    currentId,
    isSelectMode: false,
    exitSelectMode: () => {},
    navigate,
    locationSearch: "",
    onNewContact: () => {},
    onSmartPaste: () => {},
  });
  return null;
};

describe("useContactListKeyboard", () => {
  it("steps from the open contact, down and back up", () => {
    const navigate = vi.fn();
    const { rerender } = render(
      <Harness currentId={undefined} navigate={navigate} />,
    );
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(navigate).toHaveBeenLastCalledWith("/contact/ada");

    rerender(<Harness currentId="ada" navigate={navigate} />);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(navigate).toHaveBeenLastCalledWith("/contact/edsger");

    rerender(<Harness currentId="edsger" navigate={navigate} />);
    fireEvent.keyDown(document.body, { key: "k" });
    expect(navigate).toHaveBeenLastCalledWith("/contact/ada");
  });

  it("attaches its listener once, whatever changes", () => {
    const add = vi.spyOn(window, "addEventListener");
    const navigate = vi.fn();
    const { rerender } = render(
      <Harness currentId={undefined} navigate={navigate} />,
    );
    rerender(<Harness currentId="ada" navigate={navigate} />);
    rerender(<Harness currentId="edsger" navigate={navigate} />);
    const keydowns = add.mock.calls.filter(([type]) => type === "keydown");
    expect(keydowns).toHaveLength(1);
  });

  it("leaves a key alone that a row already answered", () => {
    const navigate = vi.fn();
    render(<Harness currentId="ada" navigate={navigate} />);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(navigate).not.toHaveBeenCalled();
  });
});
