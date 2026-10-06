// @vitest-environment jsdom
/**
 * useContactListKeyboard: the arrows and j/k walk the list from the open
 * contact. The listener is attached once and reads the latest values from a
 * ref written in the commit, so a fast second ArrowDown steps from the new
 * current row and does not reopen the row that is already open.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useContactListKeyboard } from "../../../../src/views/contact-list/hooks/useContactListKeyboard";
import type { Contact } from "../../../../src/types";

vi.mock("../../../../src/hooks/useSingleKeyShortcuts", () => ({
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
});
