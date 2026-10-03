// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FacetPills } from "../../../../src/components/command-palette/FacetPills";

describe("FacetPills", () => {
  it("names each pill by the filter that selecting it removes", () => {
    const onRemove = vi.fn();
    render(
      <FacetPills
        filters={[
          { field: "tag", value: "design" },
          { field: "near", value: "Lisbon", km: 50 },
        ]}
        onRemove={onRemove}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove filter tag: design" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter near: Lisbon/50km" }),
    );
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
