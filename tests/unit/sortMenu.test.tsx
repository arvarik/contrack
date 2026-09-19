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
  it("renders five sort choices with the current one checked", () => {
    mountWrapper("name_asc");
    const trigger = screen.getByRole("button", { name: "Sort: Name A to Z" });
    expect(trigger).toBeDefined();

    fireEvent.click(trigger);

    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items).toHaveLength(5);

    const labels = items.map((i) => i.textContent?.trim());
    expect(labels).toEqual([
      "Name A to Z",
      "Name Z to A",
      "Newest first",
      "Oldest first",
      "Score",
    ]);

    const checked = items.filter(
      (i) => i.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent?.trim()).toBe("Name A to Z");
  });

  it("initializes from the listSort preference correctly", () => {
    // When preference is score
    const choiceScore = getSortChoice("score", "desc");
    expect(choiceScore.label).toBe("Score");

    const { unmount } = render(<SortMenuWrapper initialSortId="score-desc" />);
    expect(screen.getByRole("button", { name: "Sort: Score" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Sort: Score" }));
    const scoreItem = screen.getByRole("menuitemcheckbox", { name: "Score" });
    expect(scoreItem.getAttribute("aria-checked")).toBe("true");

    unmount();

    // When preference is date-desc
    render(<SortMenuWrapper initialSortId="date-desc" />);
    expect(
      screen.getByRole("button", { name: "Sort: Newest first" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Sort: Newest first" }));
    const newestItem = screen.getByRole("menuitemcheckbox", {
      name: "Newest first",
    });
    expect(newestItem.getAttribute("aria-checked")).toBe("true");
  });

  it("updates checked item and trigger label when a new choice is selected", () => {
    const onChoiceChange = vi.fn();
    render(
      <SortMenuWrapper
        initialSortId="name-asc"
        onChoiceChange={onChoiceChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Sort: Name A to Z" });
    fireEvent.click(trigger);

    const oldestOption = screen.getByRole("menuitemcheckbox", {
      name: "Oldest first",
    });
    fireEvent.click(oldestOption);

    expect(onChoiceChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "date-asc",
        label: "Oldest first",
      }),
    );

    // After selection, the trigger label should update
    const updatedTrigger = screen.getByRole("button", {
      name: "Sort: Oldest first",
    });
    expect(updatedTrigger).toBeDefined();

    // Reopen menu and check aria-checked
    fireEvent.click(updatedTrigger);
    const checked = screen
      .getAllByRole("menuitemcheckbox")
      .filter((i) => i.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent?.trim()).toBe("Oldest first");
  });
});

function mountWrapper(initialSortId?: string) {
  return render(<SortMenuWrapper initialSortId={initialSortId} />);
}
