// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AccountAvatar } from "../../src/components/auth/AccountIdentity";
import { AccountPhotoField } from "../../src/components/auth/AccountPhotoField";

describe("AccountAvatar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the photo when avatarUrl is set", () => {
    const user = {
      username: "alice",
      displayName: "Alice Smith",
      avatarUrl: "/uploads/u/user-123/profile/profile-1789.jpg",
    };

    const { container } = render(<AccountAvatar user={user} size={48} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(
      "/uploads/u/user-123/profile/profile-1789.jpg",
    );
  });

  it("renders the monogram when avatarUrl is null", () => {
    const user = {
      username: "bob",
      displayName: "Bob Jones",
      avatarUrl: null,
    };

    const { container } = render(<AccountAvatar user={user} size={32} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain("/api/avatar/initials");
    expect(img?.getAttribute("src")).toContain("bob");
  });

  it("swaps to the monogram on an image error", () => {
    const user = {
      username: "carol",
      displayName: "Carol Danvers",
      avatarUrl: "/uploads/u/carol/profile/missing.jpg",
    };

    const { container } = render(<AccountAvatar user={user} size={36} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(
      "/uploads/u/carol/profile/missing.jpg",
    );

    // Trigger image error
    fireEvent.error(img);

    // Swaps to monogram
    expect(img.getAttribute("src")).toContain("/api/avatar/initials");
    expect(img.getAttribute("src")).toContain("carol");
  });
});

describe("AccountPhotoField", () => {
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    window.URL.createObjectURL = vi.fn((file: Blob | MediaSource) => {
      const url = `blob:mock-url-${(file as File).name || "file"}`;
      createdUrls.push(url);
      return url;
    });
    window.URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("rejects a 20 MB file with inline text and does not call onChange", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <AccountPhotoField
        value={null}
        fallbackUrl="/api/avatar/initials?seed=test"
        onChange={onChange}
      />,
    );

    const input = container.querySelector('input[type="file"]')!;
    const largeBytes = new Uint8Array(20 * 1024 * 1024);
    const largeFile = new File([largeBytes], "huge.png", { type: "image/png" });

    // Simulate selecting the 20 MB file
    fireEvent.change(input, {
      target: { files: [largeFile] },
    });

    // Inline error text must be displayed
    await waitFor(() => {
      expect(screen.getByText("Image must be under 10 MB.")).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange when a valid file is chosen and clears error", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <AccountPhotoField
        value={null}
        fallbackUrl="/api/avatar/initials?seed=test"
        onChange={onChange}
      />,
    );

    const input = container.querySelector('input[type="file"]')!;
    const validFile = new File(["valid image content"], "photo.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(input, {
      target: { files: [validFile] },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(validFile);
    });
    expect(screen.queryByText("Image must be under 10 MB.")).toBeNull();
  });

  it("creates and revokes object URLs properly", () => {
    const validFile = new File(["test"], "avatar.png", { type: "image/png" });
    const { rerender, unmount, container } = render(
      <AccountPhotoField
        value={validFile}
        fallbackUrl="/api/avatar/initials?seed=test"
        onChange={() => {}}
      />,
    );

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(validFile);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:mock-url-avatar.png");

    // Clear value
    rerender(
      <AccountPhotoField
        value={null}
        fallbackUrl="/api/avatar/initials?seed=test"
        onChange={() => {}}
      />,
    );
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:mock-url-avatar.png",
    );

    // Unmount
    unmount();
  });

  it("handles remove button for value and currentUrl", () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    const validFile = new File(["test"], "avatar.png", { type: "image/png" });

    // When value is set
    const { rerender } = render(
      <AccountPhotoField
        value={validFile}
        fallbackUrl="/fallback.png"
        onChange={onChange}
        onRemove={onRemove}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: "Remove" });
    expect(removeBtn).toBeTruthy();
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(null);

    // When value is null and currentUrl is set
    onChange.mockClear();
    rerender(
      <AccountPhotoField
        value={null}
        currentUrl="/uploads/profile.jpg"
        fallbackUrl="/fallback.png"
        onChange={onChange}
        onRemove={onRemove}
      />,
    );

    const removeBtn2 = screen.getByRole("button", { name: "Remove" });
    expect(removeBtn2).toBeTruthy();
    fireEvent.click(removeBtn2);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onRemove).toHaveBeenCalled();
  });
});
