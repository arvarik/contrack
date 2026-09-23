// @vitest-environment jsdom
/**
 * A radio group's keyboard: one Tab stop, and the arrows move the choice.
 * The settings pages and the duplicate review build their groups from
 * buttons, and these two helpers give each of them what a native group has.
 */
import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { radioKeys, radioTabIndex } from "../../src/lib/a11y";

afterEach(cleanup);

const OPTIONS = ["30 days", "90 days", "A year"] as const;

const Group = ({ initial }: { initial: string | null }) => {
  const [value, setValue] = useState<string | null>(initial);
  const anyChecked = OPTIONS.some((option) => option === value);
  return (
    <div role="radiogroup" aria-label="Expires">
      {OPTIONS.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          tabIndex={radioTabIndex(option === value, index, anyChecked)}
          onKeyDown={radioKeys}
          onClick={() => setValue(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
};

const radio = (name: string) => screen.getByRole("radio", { name });

describe("radioTabIndex", () => {
  it("makes the checked option the one Tab stop", () => {
    render(<Group initial="90 days" />);
    expect(OPTIONS.map((o) => radio(o).tabIndex)).toEqual([-1, 0, -1]);
  });

  it("falls back to the first option when none is checked", () => {
    render(<Group initial="7 days" />);
    expect(OPTIONS.map((o) => radio(o).tabIndex)).toEqual([0, -1, -1]);
  });
});

describe("radioKeys", () => {
  it("moves the choice and the focus with the arrows, wrapping at the ends", () => {
    render(<Group initial="30 days" />);
    radio("30 days").focus();

    fireEvent.keyDown(radio("30 days"), { key: "ArrowRight" });
    expect(radio("90 days").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio("90 days"));

    fireEvent.keyDown(radio("90 days"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(radio("A year"));
    fireEvent.keyDown(radio("A year"), { key: "ArrowDown" });
    expect(radio("30 days").getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(radio("30 days"), { key: "ArrowLeft" });
    expect(radio("A year").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("A year"), { key: "ArrowUp" });
    expect(radio("90 days").getAttribute("aria-checked")).toBe("true");
    // The tab stop follows the choice.
    expect(radio("90 days").tabIndex).toBe(0);
  });

  it("leaves every other key alone", () => {
    render(<Group initial="30 days" />);
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    radio("30 days").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(radio("30 days").getAttribute("aria-checked")).toBe("true");
  });
});
