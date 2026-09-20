// @vitest-environment jsdom
// =============================================================================
// Select: the app's dropdown for choosing a value
// =============================================================================
// It replaces the native <select>. `role="combobox"` with a listbox promises
// keys: the arrows open and move, Home and End jump, a letter finds an
// option, Enter chooses, Escape goes back to the button. The label chip on a
// contact, the model picker and the bulk edit field picker all share this
// one control, so its keys are checked here once.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Mail, Phone } from "lucide-react";
import { Select, type SelectOption } from "../../src/components/ui/Select";

afterEach(() => {
  cleanup();
});

const OPTIONS: SelectOption[] = [
  { value: "work", label: "Work", icon: Mail },
  { value: "personal", label: "Personal", icon: Phone },
  { value: "other", label: "Other" },
];

function mount(
  props: Partial<React.ComponentProps<typeof Select>> = {},
  options: readonly SelectOption[] = OPTIONS,
) {
  const onChange = vi.fn();
  render(
    <>
      <Select
        label="Label for ada"
        value="personal"
        onChange={onChange}
        options={options}
        {...props}
      />
      <button type="button">After</button>
    </>,
  );
  return {
    onChange,
    trigger: screen.getByRole("combobox", { name: "Label for ada" }),
  };
}

describe("the trigger", () => {
  it("is a combobox button that shows the chosen option and opens a listbox on it", () => {
    const { trigger } = mount();
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toBe("Personal");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(trigger);
    const list = screen.getByRole("listbox", { name: "Label for ada" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(list.id);
    const chosen = screen.getByRole("option", { name: "Personal" });
    expect(chosen.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(chosen);
    expect(
      screen
        .getByRole("option", { name: "Work" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("opens with ArrowDown and ArrowUp", () => {
    const { trigger } = mount();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("shows the placeholder when no option has the value", () => {
    const { trigger } = mount({ value: "nope", placeholder: "Choose" });
    expect(trigger.textContent).toBe("Choose");
  });
});

describe("the list", () => {
  it("moves with the arrows and wraps, jumps with Home and End, and skips disabled options", () => {
    const { trigger } = mount({}, [
      ...OPTIONS,
      { value: "off", label: "Off", disabled: true },
    ]);
    fireEvent.click(trigger);
    const active = () => document.activeElement?.textContent;
    expect(active()).toBe("Personal");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(active()).toBe("Other");
    // "Off" is disabled, so the next step wraps to the top.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(active()).toBe("Work");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(active()).toBe("Other");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(active()).toBe("Work");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(active()).toBe("Other");
  });

  it("jumps to the next option that starts with a typed letter", () => {
    const { trigger } = mount();
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "w" });
    expect(document.activeElement?.textContent).toBe("Work");
    fireEvent.keyDown(document.activeElement!, { key: "o" });
    expect(document.activeElement?.textContent).toBe("Other");
  });

  it("chooses on click, closes, gives focus back and reports the change once", () => {
    const { trigger, onChange } = mount();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Work" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("work");
  });

  it("does not report a choice of the current value, or of a disabled option", () => {
    const { trigger, onChange } = mount({}, [
      ...OPTIONS,
      { value: "off", label: "Off", disabled: true },
    ]);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Personal" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Off" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("closes on Escape, marks the key handled, and returns focus to the trigger", () => {
    const { trigger } = mount();
    fireEvent.click(trigger);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.activeElement!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Tab and on a press outside", () => {
    const { trigger } = mount();
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "After" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("puts grouped options under their headings, ungrouped first", () => {
    const { trigger } = mount({ value: "a::x" }, [
      { value: "auto", label: "Automatic" },
      { value: "a::x", label: "Model X", group: "Anthropic" },
      { value: "o::y", label: "Model Y", group: "OpenAI" },
      { value: "a::z", label: "Model Z", group: "Anthropic" },
    ]);
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    const text = Array.from(list.children).map((node) =>
      node.textContent?.trim(),
    );
    expect(text).toEqual([
      "Automatic",
      "Anthropic",
      "Model X",
      "Model Z",
      "OpenAI",
      "Model Y",
    ]);
  });
});

describe("the forms", () => {
  it("draws a chip in uppercase with a 44 px tap box, and a field full width", () => {
    const { trigger } = mount({ variant: "chip" });
    expect(trigger.className).toContain("hit-area");
    expect(trigger.className).toContain("uppercase");
    cleanup();
    const field = mount({ variant: "field" }).trigger;
    expect(field.className).toContain("w-full");
    expect(field.className).not.toContain("uppercase");
  });
});
