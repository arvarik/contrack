// @vitest-environment jsdom
// =============================================================================
// AccentPicker — a radiogroup that behaves like one
// =============================================================================
// Two things are easy to get wrong here and neither shows up by clicking.
//
// The role promises keyboard behaviour. Only the selected option is a tab
// stop, so without arrow handling the other seven swatches cannot be reached
// from a keyboard at all — the control would be worse for a keyboard user than
// eight plain buttons.
//
// And the swatch has to show what the app will paint. The default accent is
// never derived (the shipped palette is hand-tuned and measured), so deriving
// it for the swatch would put a colour on screen that appears nowhere else.
// =============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AccentPicker,
  ACCENT_PRESETS,
} from "../../src/components/ui/AccentPicker";
import { DEFAULT_ACCENT, deriveAccent, LIGHT } from "../../src/lib/theme";
import { hexToRgb } from "../../src/lib/color";

afterEach(cleanup);

const swatches = () => screen.getAllByRole("radio");

describe("keyboard", () => {
  it("moves the selection with the arrows, in both directions", () => {
    const onChange = vi.fn();
    render(
      <AccentPicker value={DEFAULT_ACCENT} onChange={onChange} mode="light" />,
    );

    fireEvent.keyDown(swatches()[0], { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(ACCENT_PRESETS[1].value);

    fireEvent.keyDown(swatches()[0], { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(
      ACCENT_PRESETS[ACCENT_PRESETS.length - 1].value,
    );
  });

  it("wraps at both ends", () => {
    const onChange = vi.fn();
    const last = ACCENT_PRESETS[ACCENT_PRESETS.length - 1].value;
    render(<AccentPicker value={last} onChange={onChange} mode="light" />);

    fireEvent.keyDown(swatches()[0], { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(ACCENT_PRESETS[0].value);
  });

  it("starts from the first swatch when a custom colour is chosen", () => {
    const onChange = vi.fn();
    render(<AccentPicker value="#123456" onChange={onChange} mode="light" />);

    fireEvent.keyDown(swatches()[0], { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(ACCENT_PRESETS[1].value);
  });

  it("leaves other keys alone", () => {
    const onChange = vi.fn();
    render(
      <AccentPicker value={DEFAULT_ACCENT} onChange={onChange} mode="light" />,
    );
    fireEvent.keyDown(swatches()[0], { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps exactly one swatch in the tab order", () => {
    render(
      <AccentPicker value={DEFAULT_ACCENT} onChange={() => {}} mode="light" />,
    );
    const reachable = swatches().filter((b) => b.tabIndex === 0);
    expect(reachable).toHaveLength(1);
  });

  it("still offers a tab stop when the colour is a custom one", () => {
    // Otherwise the whole row drops out of the tab order the moment somebody
    // picks something off it.
    render(<AccentPicker value="#123456" onChange={() => {}} mode="light" />);
    expect(swatches().filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });
});

describe("what the swatches show", () => {
  it("paints the shipped palette for the default accent, not a derived one", () => {
    render(
      <AccentPicker value={DEFAULT_ACCENT} onChange={() => {}} mode="light" />,
    );
    // Deriving it would be close, and visibly not the colour on the buttons
    // beside it — `applyTheme` leaves the hand-tuned values alone for this one.
    expect(swatches()[0].style.backgroundColor).toBe("rgb(0, 106, 145)");
    expect(deriveAccent(DEFAULT_ACCENT, "light").primary).not.toBe(
      LIGHT.primary,
    );
  });

  it("paints the derived colour for every other preset", () => {
    render(
      <AccentPicker value={DEFAULT_ACCENT} onChange={() => {}} mode="light" />,
    );
    const teal = ACCENT_PRESETS[1];
    const derived = hexToRgb(deriveAccent(teal.value, "light").primary);
    expect(swatches()[1].style.backgroundColor).toBe(
      `rgb(${derived.r}, ${derived.g}, ${derived.b})`,
    );
    // Not the raw value somebody picked: that one does not clear the contract.
    const asked = hexToRgb(teal.value);
    expect(swatches()[1].style.backgroundColor).not.toBe(
      `rgb(${asked.r}, ${asked.g}, ${asked.b})`,
    );
  });

  it("paints a different colour in each palette", () => {
    const { rerender } = render(
      <AccentPicker value={DEFAULT_ACCENT} onChange={() => {}} mode="light" />,
    );
    const light = swatches()[1].style.backgroundColor;
    rerender(
      <AccentPicker value={DEFAULT_ACCENT} onChange={() => {}} mode="dark" />,
    );
    expect(swatches()[1].style.backgroundColor).not.toBe(light);
  });

  it("names every swatch for a screen reader", () => {
    render(
      <AccentPicker value={DEFAULT_ACCENT} onChange={() => {}} mode="light" />,
    );
    for (const preset of ACCENT_PRESETS) {
      expect(screen.getByRole("radio", { name: preset.label })).toBeDefined();
    }
    expect(screen.getAllByRole("radio")[0].getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});
