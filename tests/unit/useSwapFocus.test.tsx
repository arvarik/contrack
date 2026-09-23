// @vitest-environment jsdom
/**
 * Select and Done swap places, and the keyboard follows the swap instead of
 * falling onto the body.
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwapFocus } from "../../src/components/bulk/useSwapFocus";

const page = () => {
  document.body.innerHTML = `
    <button id="select">Select</button>
    <button id="done">Done</button>
    <button id="row">A row</button>
    <div role="toolbar" aria-label="Bulk actions"><button id="csv">CSV</button></div>
  `;
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    select: { current: byId("select") },
    done: { current: byId("done") },
    row: byId("row"),
    csv: byId("csv"),
  };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useSwapFocus", () => {
  it("gives Done the focus when the mode starts and nothing holds it", () => {
    const { select, done } = page();
    const { rerender } = renderHook(
      ({ on }) => useSwapFocus(on, done, select),
      { initialProps: { on: false } },
    );
    (document.activeElement as HTMLElement | null)?.blur();
    rerender({ on: true });
    expect(document.activeElement).toBe(done.current);
  });

  it("gives Select the focus when the mode ends from a bulk bar button", () => {
    // CSV or Escape ends the mode while a bar button has focus. The bar
    // leaves after its exit animation, so that focus is as good as lost.
    const { select, done, csv } = page();
    const { rerender } = renderHook(
      ({ on }) => useSwapFocus(on, done, select),
      { initialProps: { on: true } },
    );
    csv.focus();
    rerender({ on: false });
    expect(document.activeElement).toBe(select.current);
  });

  it("leaves focus that is somewhere else where it is", () => {
    const { select, done, row } = page();
    const { rerender } = renderHook(
      ({ on }) => useSwapFocus(on, done, select),
      { initialProps: { on: true } },
    );
    row.focus();
    rerender({ on: false });
    expect(document.activeElement).toBe(row);
  });
});
