// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../src/api", () => ({
  useUploadAvatar: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDicebearAvatar: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences: { theme: "system" }, mode: "light" }),
}));

import { AvatarPickerModal } from "../../../src/components/AvatarPickerModal";

describe("the avatar picker's upload tab", () => {
  afterEach(cleanup);

  it("lists every format the server accepts, AVIF included", async () => {
    render(<AvatarPickerModal isOpen onClose={vi.fn()} contactId="c-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Upload a photo/ }));

    // server/utils/avatarProcessor.ts: JPEG, PNG, GIF, WebP and AVIF.
    // The new tab enters after the old one has left.
    expect(
      await screen.findByText("JPEG, PNG, WebP, GIF, AVIF · up to 10 MB"),
    ).toBeTruthy();
  });
});
