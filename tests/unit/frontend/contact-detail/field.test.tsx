// @vitest-environment jsdom
/**
 * The Details card's one pattern for a value, in the DOM.
 *
 * The card had three ways to add a value, uppercase labels under an uppercase
 * heading, a 19 px label select, and a remove button beside each row. Each
 * value is now a `Field`: a sentence case label, the value that edits in
 * place, a label chip, a kebab with the row's actions, and one "+ Add"
 * button. These tests read the names a screen reader hears and press the keys
 * a keyboard user presses.
 *
 * `LocationMiniMap` loads MapLibre, which needs WebGL, so it is a stub here.
 * `sonner` is a spy, so a test can read a toast and press its "Undo".
 */
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { UNDO_DURATION_MS } from "../../../../src/lib/undoToast";
import type { Contact } from "../../../../src/types";
import { DetailsCard } from "../../../../src/views/contact-detail/components/DetailsCard";
import { Field } from "../../../../src/views/contact-detail/components/Field";
import {
  ADDR_LABELS,
  EMAIL_LABELS,
  MultiValueField,
  type MultiValueItem,
} from "../../../../src/views/contact-detail/components/MultiValueField";

// The next follow-up reads the contact's follow-ups.
vi.mock("../../../../src/api/actionItems", () => ({
  useContactActionItems: () => ({
    data: [
      { id: "a1", title: "Call back", dueAt: "2026-10-01", completedAt: null },
    ],
  }),
  useUpdateActionItem: () => ({ mutate: vi.fn() }),
  useCompleteActionItem: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../../../src/views/map/LocationMiniMap", () => ({
  LocationMiniMap: () => <div data-testid="mini-map" />,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADA = {
  id: "c1",
  name: "Ada Lovelace",
  location: null,
  birthday: null,
  preferences: null,
  industry: null,
  nextFollowUpAt: null,
  lat: 51.5074,
  lng: -0.1278,
  addresses: [
    {
      id: "a1",
      address: "1 Main St, London, UK",
      label: "home",
      isPrimary: true,
    },
    {
      id: "a2",
      address: "2 High St, Leeds, UK",
      label: "work",
      isPrimary: false,
    },
  ],
  emails: [
    { id: "e1", email: "ada@example.com", label: "work", isPrimary: true },
    { id: "e2", email: "ada@home.test", label: "personal", isPrimary: false },
  ],
  phones: [],
  interests: [],
};

const drawCard = (
  over: Record<string, unknown> = {},
  props: Partial<React.ComponentProps<typeof DetailsCard>> = {},
) => {
  const onUpdate = vi.fn();
  const mutate = vi.fn();
  render(
    <MemoryRouter>
      <DetailsCard
        contact={{ ...ADA, ...over } as unknown as Contact}
        contactId="c1"
        onUpdate={onUpdate}
        updateContact={mutate}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onUpdate, mutate };
};

const EMAILS: MultiValueItem[] = [
  { id: "e1", value: "a@x.com", label: "work" },
  { id: "e2", value: "b@x.com", label: "personal" },
  { id: "e3", value: "c@x.com", label: "other" },
];

const saved = (items: MultiValueItem[]) =>
  items.map(({ value, label }) => ({ value, label }));

const drawEmails = (
  items: MultiValueItem[] = EMAILS,
  props: Partial<React.ComponentProps<typeof MultiValueField>> = {},
) => {
  const onSave = vi.fn();
  const view = render(
    <MemoryRouter>
      <MultiValueField
        items={items}
        onSave={onSave}
        labelOptions={EMAIL_LABELS}
        noun="email"
        addLabel="Add email"
        inputPlaceholder="email@example.com"
        {...props}
      />
    </MemoryRouter>,
  );
  return { onSave, ...view };
};

/**
 * A field whose parent saves at once. Each save drops the ids, the way a
 * server that writes new rows answers, so every row mounts again and focus
 * has to be put back on purpose.
 */
const Harness = ({ onSave }: { onSave: (list: MultiValueItem[]) => void }) => {
  const [items, setItems] = useState<MultiValueItem[]>(EMAILS);
  return (
    <MemoryRouter>
      <MultiValueField
        items={items}
        onSave={(list) => {
          onSave(list);
          setItems(list);
        }}
        labelOptions={EMAIL_LABELS}
        noun="email"
        addLabel="Add email"
        inputPlaceholder="email@example.com"
      />
    </MemoryRouter>
  );
};

const menuItems = () =>
  within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((item) => item.textContent);

/** The first plain toast: its text, its duration and its action. */
const firstToast = () => {
  const [label, options] = vi.mocked(toast).mock.calls[0];
  const { duration, action } = options as unknown as {
    duration: number;
    action: { label: string; onClick: () => void };
  };
  return { label, duration, action };
};

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

describe("Field", () => {
  it("names a group by its label, holds its children and draws no add button", () => {
    render(
      <Field label="Industry">
        <span>Law</span>
      </Field>,
    );
    const group = screen.getByRole("group", { name: "Industry" });
    expect(within(group).getByText("Law")).toBeTruthy();
    expect(within(group).queryByRole("button")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

describe("DetailsCard", () => {
  it("keeps the uppercase heading as an h2 and labels fields in sentence case", () => {
    drawCard({ nextFollowUpAt: "2026-10-01T09:00:00.000Z" });
    expect(
      screen.getByRole("heading", { level: 2, name: "Details" }),
    ).toBeTruthy();
    for (const label of [
      "Location",
      "Email",
      "Phone",
      "Birthday",
      "Industry",
      "Preferences",
      "Interests",
      "Next follow-up",
    ]) {
      expect(screen.getByRole("group", { name: label })).toBeTruthy();
      expect(screen.getByText(label).textContent).toBe(label);
      expect(screen.queryByText(label.toUpperCase())).toBeNull();
    }
    expect(screen.queryByText("Next Follow Up")).toBeNull();
    // A calendar day with no time: no false "12:00 AM", and a way to fix it.
    expect(screen.getByText(/^Call back · /).textContent).not.toMatch(/AM|PM/);
    expect(
      screen.getByRole("button", { name: "Change follow-up: Call back" }),
    ).toBeTruthy();
  });

  it("gives each row a named label chip and a named kebab", () => {
    drawCard();
    // A Select, not a native select: a button that opens a listbox.
    const chip = screen.getByRole("combobox", {
      name: "Label for ada@example.com",
    });
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.getAttribute("aria-haspopup")).toBe("listbox");
    const kebab = screen.getByRole("button", {
      name: "Actions for ada@example.com",
    });
    expect(kebab.getAttribute("aria-haspopup")).toBe("menu");
    // An address row names the address by its first two parts.
    expect(
      screen.getByRole("button", { name: "Actions for 1 Main St, London" }),
    ).toBeTruthy();
  });

  it("names one add button per list field and shows no placeholder text", () => {
    drawCard({ phones: [] });
    for (const name of ["Add location", "Add email", "Add phone"]) {
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    }
    expect(screen.queryByText(/Add Phone|Add another/)).toBeNull();
  });

  it("offers Show on map on address rows only, and Make primary after the first row", () => {
    drawCard();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for 1 Main St, London" }),
    );
    expect(menuItems()).toEqual(["Show on map", "Remove"]);
    // jsdom is a narrow screen: the map opens at the pin, not under the
    // contact (`useMapLink`).
    expect(
      screen
        .getByRole("menuitem", { name: "Show on map" })
        .getAttribute("href"),
    ).toBe("/map");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for 2 High St, Leeds" }),
    );
    expect(menuItems()).toEqual(["Make primary", "Show on map", "Remove"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for ada@example.com" }),
    );
    expect(menuItems()).toEqual(["Remove"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for ada@home.test" }),
    );
    expect(menuItems()).toEqual(["Make primary", "Remove"]);
  });

  it("marks the map pin on the first address only while the contact is placed", () => {
    drawCard();
    const location = screen.getByRole("group", { name: "Location" });
    expect(within(location).getAllByText("Map pin")).toHaveLength(1);
    expect(
      within(screen.getByRole("group", { name: "Email" })).queryByText(
        "Map pin",
      ),
    ).toBeNull();
    cleanup();

    drawCard({ lat: null, lng: null });
    expect(screen.queryByText("Map pin")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for 1 Main St, London" }),
    );
    expect(menuItems()).toEqual(["Remove"]);
  });

  it("saves the whole address list with the new primary first", () => {
    const { mutate } = drawCard();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for 2 High St, Leeds" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Make primary" }));
    expect(mutate).toHaveBeenCalledWith({
      id: "c1",
      data: {
        addresses: [
          { address: "2 High St, Leeds, UK", label: "work", isPrimary: true },
          { address: "1 Main St, London, UK", label: "home", isPrimary: false },
        ],
      },
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Map pin updated to: 2 High St, Leeds",
      { duration: 3000 },
    );
  });

  it("gives an empty Birthday and Industry the card's one + Add, and puts focus back after Escape", () => {
    const { onUpdate } = drawCard();
    const birthday = screen.getByRole("button", { name: "Add birthday" });
    expect(birthday.textContent).toBe("Add");
    fireEvent.click(birthday);
    const date = screen.getByLabelText("Birthday", { selector: "input" });
    fireEvent.keyDown(date, { key: "Escape" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add birthday" }),
    );

    const industry = screen.getByRole("button", { name: "Add industry" });
    expect(industry.textContent).toBe("Add");
    fireEvent.click(industry);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Add industry" }), {
      key: "Escape",
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add industry" }),
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("saves a typed birthday once, on Enter, and keeps a day with no year", () => {
    const { onUpdate } = drawCard();
    fireEvent.click(screen.getByRole("button", { name: "Add birthday" }));
    const field = screen.getByLabelText("Birthday", { selector: "input" });
    // A date input saved after the first digit typed.
    fireEvent.change(field, { target: { value: "May 1" } });
    fireEvent.change(field, { target: { value: "May 14" } });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith("birthday", "05-14");
  });

  it("adds preferences split on commas and names each chip's remove button", () => {
    const { onUpdate } = drawCard({ preferences: "Coffee" });
    const group = screen.getByRole("group", { name: "Preferences" });
    fireEvent.click(
      within(group).getByRole("button", { name: "Add preference" }),
    );
    const input = within(group).getByRole("textbox", {
      name: "New preference",
    });
    fireEvent.change(input, { target: { value: "Tea, Jazz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUpdate).toHaveBeenCalledWith("preferences", "Coffee, Tea, Jazz");
    expect(
      within(group).getByRole("button", { name: "Remove preference Coffee" }),
    ).toBeTruthy();
  });

  it("removes a preference with an undo toast", () => {
    const { onUpdate } = drawCard({ preferences: "Coffee, Tea" });
    const remove = screen.getByRole("button", {
      name: "Remove preference Tea",
    });
    fireEvent.click(remove);
    expect(onUpdate).toHaveBeenCalledWith("preferences", "Coffee");

    expect(toast).toHaveBeenCalledTimes(1);
    const { label, duration, action } = firstToast();
    expect(label).toBe('Removed "Tea"');
    expect(duration).toBe(UNDO_DURATION_MS);
    expect(action.label).toBe("Undo");
    action.onClick();
    expect(onUpdate).toHaveBeenLastCalledWith("preferences", "Coffee, Tea");
  });

  it("adds and removes interests through the interests list, with undo", () => {
    const interests = [
      { id: "i1", interest: "Chess", isAiGenerated: false },
      { id: "i2", interest: "Opera", isAiGenerated: true },
    ];
    const { mutate } = drawCard({ interests });
    const group = screen.getByRole("group", { name: "Interests" });

    fireEvent.click(
      within(group).getByRole("button", { name: "Remove interest Opera" }),
    );
    expect(mutate).toHaveBeenCalledWith({
      id: "c1",
      data: { interests: [interests[0]] },
    });
    expect(firstToast().label).toBe('Removed "Opera"');
    firstToast().action.onClick();
    expect(mutate).toHaveBeenLastCalledWith({
      id: "c1",
      data: { interests },
    });

    fireEvent.click(
      within(group).getByRole("button", { name: "Add interest" }),
    );
    const input = within(group).getByRole("textbox", { name: "New interest" });
    fireEvent.change(input, { target: { value: "Sailing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const call = mutate.mock.lastCall;
    if (!call) throw new Error("The new interest was not saved");
    const last = call[0] as {
      data: { interests: { interest: string; isAiGenerated: boolean }[] };
    };
    expect(last.data.interests.map((i) => i.interest)).toEqual([
      "Chess",
      "Opera",
      "Sailing",
    ]);
    expect(last.data.interests[2].isAiGenerated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

describe("MultiValueField", () => {
  it("puts the pencil after every value", () => {
    const { container } = drawEmails();
    const values = container.querySelectorAll("[data-row-value] button");
    expect(values).toHaveLength(3);
    for (const value of values) {
      expect(value.querySelector("[data-edit-hint]")).not.toBeNull();
    }
  });

  it("moves a row to the top with Make primary", () => {
    const { onSave } = drawEmails();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for c@x.com" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Make primary" }));
    expect(onSave).toHaveBeenCalledWith(
      saved([EMAILS[2], EMAILS[0], EMAILS[1]]),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("removes a row, and Undo saves the list as it was", () => {
    const { onSave } = drawEmails();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for b@x.com" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(onSave).toHaveBeenCalledWith(saved([EMAILS[0], EMAILS[2]]));

    const { label, duration, action } = firstToast();
    expect(label).toBe('Removed "b@x.com"');
    expect(duration).toBe(UNDO_DURATION_MS);
    expect(action.label).toBe("Undo");
    action.onClick();
    expect(onSave).toHaveBeenLastCalledWith(saved(EMAILS));
  });

  it("edits a value with Enter, and saves the whole list", () => {
    const { onSave } = drawEmails();
    fireEvent.keyDown(screen.getByRole("button", { name: "b@x.com" }), {
      key: "Enter",
    });
    const input = screen.getByRole("textbox", { name: "Edit email" });
    fireEvent.change(input, { target: { value: "bee@x.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith([
      { value: "a@x.com", label: "work" },
      { value: "bee@x.com", label: "personal" },
      { value: "c@x.com", label: "other" },
    ]);
  });

  it("cancels an edit with Escape and puts focus back on the value", () => {
    const { onSave } = drawEmails();
    fireEvent.keyDown(screen.getByRole("button", { name: "b@x.com" }), {
      key: "Enter",
    });
    const input = screen.getByRole("textbox", { name: "Edit email" });
    fireEvent.change(input, { target: { value: "nope@x.com" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Edit email" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "b@x.com" }),
    );
  });

  it("ignores an empty save instead of removing the row", () => {
    const { onSave } = drawEmails();
    fireEvent.keyDown(screen.getByRole("button", { name: "a@x.com" }), {
      key: "Enter",
    });
    const input = screen.getByRole("textbox", { name: "Edit email" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a new label from the chip", () => {
    const { onSave } = drawEmails();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Label for a@x.com" }),
    );
    const list = screen.getByRole("listbox", { name: "Label for a@x.com" });
    expect(
      within(list)
        .getByRole("option", { name: "work" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.click(within(list).getByRole("option", { name: "other" }));
    expect(onSave).toHaveBeenCalledWith([
      { value: "a@x.com", label: "other" },
      { value: "b@x.com", label: "personal" },
      { value: "c@x.com", label: "other" },
    ]);
  });

  it("opens the add form from + Add, adds on Enter, and returns focus to + Add", () => {
    const { onSave } = drawEmails();
    const add = screen.getByRole("button", { name: "Add email" });
    expect(add.textContent).toBe("Add");
    fireEvent.click(add);
    const input = screen.getByRole("textbox", { name: "New email" });
    expect(document.activeElement).toBe(input);
    expect(
      screen.getByRole("combobox", { name: "Label for new email" }),
    ).toBeTruthy();
    fireEvent.change(input, { target: { value: "d@x.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith([
      ...saved(EMAILS),
      { value: "d@x.com", label: "work" },
    ]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add email" }),
    );
  });

  it("closes the add form on Escape without saving and focuses + Add", () => {
    const { onSave } = drawEmails([]);
    // An empty list shows the add button and nothing else.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    const input = screen.getByRole("textbox", { name: "New email" });
    fireEvent.change(input, { target: { value: "half@" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "New email" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add email" }),
    );
  });

  it("hides the drag handle until the row's kebab opens", () => {
    drawEmails();
    expect(screen.queryByRole("button", { name: /to reorder$/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for b@x.com" }),
    );
    expect(
      screen.getByRole("button", { name: "Drag b@x.com to reorder" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /to reorder$/ })).toHaveLength(
      1,
    );
  });

  it("moves a row with Alt+ArrowDown and saves the new order", () => {
    const { onSave } = drawEmails();
    fireEvent.keyDown(screen.getByRole("button", { name: "a@x.com" }), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(onSave).toHaveBeenCalledWith(
      saved([EMAILS[1], EMAILS[0], EMAILS[2]]),
    );
  });

  it("does not move the first row up or open the kebab on Alt+Arrow", () => {
    const { onSave } = drawEmails();
    fireEvent.keyDown(screen.getByRole("button", { name: "a@x.com" }), {
      key: "ArrowUp",
      altKey: true,
    });
    expect(onSave).not.toHaveBeenCalled();

    const kebab = screen.getByRole("button", { name: "Actions for b@x.com" });
    fireEvent.keyDown(kebab, { key: "ArrowDown", altKey: true });
    expect(kebab.getAttribute("aria-expanded")).toBe("false");
    expect(onSave).toHaveBeenCalledWith(
      saved([EMAILS[0], EMAILS[2], EMAILS[1]]),
    );
  });

  it("keeps focus on the moved value, announces its place and shows its handle", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "a@x.com" }), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    const moved = screen.getByRole("button", { name: "a@x.com" });
    expect(document.activeElement).toBe(moved);
    expect(
      moved.closest("[data-row-index]")?.getAttribute("data-row-index"),
    ).toBe("1");
    expect(screen.getByText("Moved to position 2 of 3")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Drag a@x.com to reorder" }),
    ).toBeTruthy();

    // Again, from its new place, to the end.
    fireEvent.keyDown(moved, { key: "ArrowDown", altKey: true });
    const last = screen.getByRole("button", { name: "a@x.com" });
    expect(document.activeElement).toBe(last);
    expect(
      last.closest("[data-row-index]")?.getAttribute("data-row-index"),
    ).toBe("2");
    expect(screen.getByText("Moved to position 3 of 3")).toBeTruthy();
  });

  it("toasts the new map pin when an address becomes primary by key", () => {
    const { onSave } = drawEmails(
      [
        { id: "a1", value: "1 Main St, London, UK", label: "home" },
        { id: "a2", value: "2 High St, Leeds, UK", label: "work" },
      ],
      {
        labelOptions: ADDR_LABELS,
        noun: "address",
        addLabel: "Add location",
        isAddress: true,
        mapLink: { to: "/map/contact/c1" },
      },
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: "2 High St, Leeds, UK" }),
      { key: "ArrowUp", altKey: true },
    );
    expect(onSave).toHaveBeenCalledWith([
      { value: "2 High St, Leeds, UK", label: "work" },
      { value: "1 Main St, London, UK", label: "home" },
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      "Map pin updated to: 2 High St, Leeds",
      { duration: 3000 },
    );
  });
});

describe("an add form opened from elsewhere on the page", () => {
  it("opens with the label asked for, focuses its input, and spends the request", () => {
    const done = vi.fn();
    drawEmails(EMAILS, {
      openRequest: 1,
      openLabel: "personal",
      onOpenRequestDone: done,
    });
    const input = screen.getByRole("textbox", { name: "New email" });
    expect(document.activeElement).toBe(input);
    expect(
      screen.getByRole("combobox", { name: "Label for new email" }).textContent,
    ).toContain("personal");
    // Spent at once, so a later mount of the field does not open it again.
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("stays closed without a request", () => {
    drawEmails(EMAILS, { onOpenRequestDone: vi.fn() });
    expect(screen.queryByRole("textbox", { name: "New email" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add email" })).toBeTruthy();
  });

  it("opens Location for the Research card's Add a city, and Email for its work email, both labelled work", () => {
    const done = vi.fn();
    drawCard(
      { addresses: [], emails: [] },
      { detailRequest: { anchor: "city", key: 1 }, onDetailRequestDone: done },
    );
    const city = screen.getByRole("textbox", { name: "New address" });
    expect(document.activeElement).toBe(city);
    expect(
      screen.getByRole("combobox", { name: "Label for new address" })
        .textContent,
    ).toContain("work");
    // Only the field asked for opens.
    expect(screen.queryByRole("textbox", { name: "New email" })).toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
    cleanup();

    drawCard(
      { addresses: [], emails: [] },
      {
        detailRequest: { anchor: "workEmail", key: 2 },
        onDetailRequestDone: vi.fn(),
      },
    );
    expect(
      screen.getByRole("combobox", { name: "Label for new email" }).textContent,
    ).toContain("work");
    expect(screen.queryByRole("textbox", { name: "New address" })).toBeNull();
  });
});
