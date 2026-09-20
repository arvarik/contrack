// @vitest-environment jsdom
// =============================================================================
// ContactListsSection: the "Add to a list" menu on the contact page
// =============================================================================
// The section draws a chip per list the contact is on, and one `ActionMenu`
// with a row per list it is not on yet. Choosing a row adds the contact to
// that list. With no list left to add, the menu button is not drawn at all.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockAdd = vi.fn();
const mockRemove = vi.fn();
let mockLists: { id: string; name: string; icon: string }[] = [];

vi.mock("../../src/api", () => ({
  useLists: () => ({ data: mockLists }),
  useAddToList: () => ({ mutate: mockAdd }),
  useRemoveFromList: () => ({ mutate: mockRemove }),
}));

import { ContactListsSection } from "../../src/views/contact-detail/components/ContactListsSection";

const pioneers = { id: "l-1", name: "Pioneers", icon: "star" };
const leaders = { id: "l-2", name: "Leaders", icon: "crown" };

function mount(contactLists: typeof mockLists) {
  render(
    <MemoryRouter>
      <ContactListsSection contactId="c-1" contactLists={contactLists} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mockAdd.mockReset();
  mockRemove.mockReset();
  mockLists = [];
});

describe("ContactListsSection", () => {
  it("adds the contact to a list chosen from the menu", () => {
    mockLists = [pioneers, leaders];
    mount([pioneers]);

    // The chip for the list the contact is on, with its remove button.
    const remove = screen.getByRole("button", { name: "Remove from Pioneers" });
    fireEvent.click(remove);
    expect(mockRemove).toHaveBeenCalledWith({
      listId: "l-1",
      contactId: "c-1",
    });

    const trigger = screen.getByRole("button", { name: "Add to a list" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Add to a list" })).toBeTruthy();
    // Only the lists the contact is not on yet are offered.
    expect(screen.queryByRole("menuitem", { name: "Pioneers" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Leaders" }));
    expect(mockAdd).toHaveBeenCalledWith({ listId: "l-2", contactId: "c-1" });
    // The menu closes and focus returns to the button.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("draws no menu button when every list already holds the contact", () => {
    mockLists = [pioneers];
    mount([pioneers]);
    expect(screen.queryByRole("button", { name: "Add to a list" })).toBeNull();
  });
});
