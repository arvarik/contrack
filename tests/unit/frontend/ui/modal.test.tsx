// @vitest-environment jsdom
import { useState, StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Modal } from "../../../../src/components/ui/Modal";

afterEach(() => {
  cleanup();
});

describe("dialog interaction", () => {
  function Nested() {
    const [outer, setOuter] = useState(false);
    const [inner, setInner] = useState(false);
    return (
      <>
        <button onClick={() => setOuter(true)}>Open parent</button>
        <Modal isOpen={outer} onClose={() => setOuter(false)} title="Parent">
          <button onClick={() => setInner(true)}>Open child</button>
          <Modal isOpen={inner} onClose={() => setInner(false)} title="Child">
            <input aria-label="Child input" />
          </Modal>
        </Modal>
      </>
    );
  }
  it("closes only the top dialog and restores focus without unlocking its parent", async () => {
    render(
      <StrictMode>
        <Nested />
      </StrictMode>,
    );
    screen.getByText("Open parent").focus();
    fireEvent.click(screen.getByText("Open parent"));
    screen.getByText("Open child").focus();
    fireEvent.click(screen.getByText("Open child"));
    expect(screen.getByRole("dialog").textContent).toContain("Child");
    expect(document.body.style.pointerEvents).toBe("none");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain("Parent"),
    );
    expect(document.body.style.pointerEvents).toBe("none");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText("Open child")),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
    expect(document.activeElement).toBe(screen.getByText("Open parent"));
  });
  it("contains Tab and Shift+Tab, and gives a headless dialog a name and the first focus", async () => {
    render(
      <Modal isOpen onClose={() => {}} ariaLabel="Contact details">
        <input aria-label="First input" />
        <input aria-label="Last input" />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Contact details" });
    // A dialog that renders its own header draws its own close control, and
    // no hidden one takes focus on open.
    expect(screen.queryByRole("button", { name: "Close dialog" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    const first = screen.getByLabelText("First input");
    const last = screen.getByLabelText("Last input");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
