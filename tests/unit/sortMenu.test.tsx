// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  ActionMenu,
  type ActionMenuItem,
} from "../../src/components/ui/ActionMenu";
import {
  SORT_CHOICES,
  getSortChoice,
  type SortChoice,
} from "../../src/views/contact-list/hooks/useContactListFilters";

afterEach(() => {
  cleanup();
});

interface SortMenuWrapperProps {
  initialSortId?: string;
  onChoiceChange?: (choice: SortChoice) => void;
}

const SortMenuWrapper: React.FC<SortMenuWrapperProps> = ({
  initialSortId = "name_asc",
  onChoiceChange,
}) => {
  const initial =
    SORT_CHOICES.find((c) => c.id === initialSortId) ?? SORT_CHOICES[0];
  const [currentSort, setCurrentSort] = useState<SortChoice>(initial);

  const items: ActionMenuItem[] = SORT_CHOICES.map((choice) => ({
    id: choice.id,
    label: choice.label,
    checked: currentSort.id === choice.id,
    onSelect: () => {
      setCurrentSort(choice);
      onChoiceChange?.(choice);
    },
  }));

  return (
    <MemoryRouter>
      <ActionMenu
        label={`Sort: ${currentSort.label}`}
        triggerContent={<span>{currentSort.label}</span>}
        items={items}
      />
    </MemoryRouter>
  );
};

describe("Network sort menu", () => {
  // Two things to order by, each read both ways. A fifth choice ordered by
  // the relationship score, which the ring on every row already shows.
  it("renders four sort choices with the current one checked", () => {
    mountWrapper("name_asc");
    const trigger = screen.getByRole("button", { name: "Sort: A to Z" });
    expect(trigger).toBeDefined();

    fireEvent.click(trigger);

    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items).toHaveLength(4);

    const labels = items.map((i) => i.textContent?.trim());
    expect(labels).toEqual(["A to Z", "Z to A", "Newest", "Oldest"]);

    const checked = items.filter(
      (i) => i.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent?.trim()).toBe("A to Z");
  });

  it("initializes from the listSort preference correctly", () => {
    // When the preference is the newest first
    const choiceNewest = getSortChoice("date", "desc");
    expect(choiceNewest.label).toBe("Newest");

    const { unmount } = render(<SortMenuWrapper initialSortId="date-desc" />);
    expect(screen.getByRole("button", { name: "Sort: Newest" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Sort: Newest" }));
    const newestItem = screen.getByRole("menuitemcheckbox", { name: "Newest" });
    expect(newestItem.getAttribute("aria-checked")).toBe("true");

    unmount();

    // When the preference is the oldest first
    render(<SortMenuWrapper initialSortId="date-asc" />);
    expect(screen.getByRole("button", { name: "Sort: Oldest" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Sort: Oldest" }));
    const oldestItem = screen.getByRole("menuitemcheckbox", { name: "Oldest" });
    expect(oldestItem.getAttribute("aria-checked")).toBe("true");
  });

  it("updates checked item and trigger label when a new choice is selected", () => {
    const onChoiceChange = vi.fn();
    render(
      <SortMenuWrapper
        initialSortId="name-asc"
        onChoiceChange={onChoiceChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Sort: A to Z" });
    fireEvent.click(trigger);

    const oldestOption = screen.getByRole("menuitemcheckbox", {
      name: "Oldest",
    });
    fireEvent.click(oldestOption);

    expect(onChoiceChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "date-asc", label: "Oldest" }),
    );

    // After selection, the trigger label should update
    const updatedTrigger = screen.getByRole("button", {
      name: "Sort: Oldest",
    });
    expect(updatedTrigger).toBeDefined();

    // Reopen menu and check aria-checked
    fireEvent.click(updatedTrigger);
    const checked = screen
      .getAllByRole("menuitemcheckbox")
      .filter((i) => i.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent?.trim()).toBe("Oldest");
  });
});

function mountWrapper(initialSortId?: string) {
  return render(<SortMenuWrapper initialSortId={initialSortId} />);
}
