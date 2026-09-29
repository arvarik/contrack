// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditableField } from "../../../../src/views/contact-detail/components/EditableField";

afterEach(() => {
  cleanup();
});

describe("inline edits", () => {
  it("does not save after Escape or during text composition", () => {
    const save = vi.fn();
    render(<EditableField value="Saved" onSave={save} placeholder="Name" />);
    fireEvent.click(screen.getByText("Saved"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Saved")).toBeTruthy();
  });
  it("retains a failed draft and confirms only a completed save", async () => {
    let resolve!: (result: boolean) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(true);
    render(<EditableField value="Saved" onSave={save} placeholder="Name" />);
    fireEvent.click(screen.getByText("Saved"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Draft" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Saved")).toBeNull();
    await act(async () => resolve(false));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Draft",
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("Saved")).toBeTruthy());
  });
});
