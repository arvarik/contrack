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
import {
  AccountFields,
  createAccountThenPhoto,
  useAccountForm,
} from "../../src/components/auth/accountForm";
import { uploadAccountAvatar } from "../../src/api/auth";

vi.mock("../../src/api/auth", () => ({
  uploadAccountAvatar: vi.fn(),
}));

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

  it("resets error state and attempts to load new image when avatarUrl changes", () => {
    const user = {
      username: "bob",
      displayName: "Bob",
      avatarUrl: "/old-broken.jpg",
    };
    const { rerender, container } = render(
      <AccountAvatar user={user} size={36} />,
    );

    const img = container.querySelector("img")!;
    fireEvent.error(img);
    expect(img.getAttribute("src")).toContain("/api/avatar/initials");

    rerender(
      <AccountAvatar
        user={{ ...user, avatarUrl: "/new-photo.jpg" }}
        size={36}
      />,
    );
    const newImg = container.querySelector("img")!;
    expect(newImg.getAttribute("src")).toBe("/new-photo.jpg");
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

  it("associates error text with aria-describedby on the dropzone and input", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <AccountPhotoField
        value={null}
        fallbackUrl="/fallback.png"
        onChange={onChange}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]')!;
    expect(fileInput.getAttribute("aria-describedby")).toBeNull();

    const oversized = new File(["a".repeat(100)], "too-big.png", {
      type: "image/png",
    });
    Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [oversized] } });

    await waitFor(() => {
      const errorElem = screen.getByRole("alert");
      expect(errorElem).toBeTruthy();
      expect(errorElem.id).toBe("account-photo-error");
      expect(fileInput.getAttribute("aria-describedby")).toBe(
        "account-photo-error",
      );
    });
  });

  it("restores focus to Choose photo button when Remove is clicked", async () => {
    const onChange = vi.fn();
    const validFile = new File(["bytes"], "me.png", { type: "image/png" });

    render(
      <AccountPhotoField
        value={validFile}
        fallbackUrl="/fallback.png"
        onChange={onChange}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: "Remove" });
    const chooseBtn = screen.getByRole("button", { name: "Choose photo" });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(document.activeElement).toBe(chooseBtn);
    });
  });
});

describe("createAccountThenPhoto", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves with photoFailed: false when submit and upload succeed", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(uploadAccountAvatar).mockResolvedValue({
      user: {
        id: "u1",
        email: "ada@example.com",
        username: "ada",
        displayName: "Ada",
        role: "admin",
        status: "active",
        credentialState: "password",
        mustChangePassword: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: null,
        avatarUrl: "/uploads/u/u1/profile/profile-1.jpg",
      },
    });
    const photo = new File(["bytes"], "photo.png", { type: "image/png" });

    const result = await createAccountThenPhoto(submit, photo);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(uploadAccountAvatar).toHaveBeenCalledWith(photo);
    expect(result).toEqual({ photoFailed: false });
  });

  it("resolves with photoFailed: true when upload throws", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(uploadAccountAvatar).mockRejectedValue(
      new Error("Upload failed"),
    );
    const photo = new File(["bytes"], "photo.png", { type: "image/png" });

    const result = await createAccountThenPhoto(submit, photo);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(uploadAccountAvatar).toHaveBeenCalledWith(photo);
    expect(result).toEqual({ photoFailed: true });
  });

  it("resolves with photoFailed: false and skips upload when photo is null", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });

    const result = await createAccountThenPhoto(submit, null);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(uploadAccountAvatar).not.toHaveBeenCalled();
    expect(result).toEqual({ photoFailed: false });
  });

  it("rethrows error when submit fails and does not attempt upload", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("Submit failed"));
    const photo = new File(["bytes"], "photo.png", { type: "image/png" });

    await expect(createAccountThenPhoto(submit, photo)).rejects.toThrow(
      "Submit failed",
    );
    expect(uploadAccountAvatar).not.toHaveBeenCalled();
  });
});

describe("AccountFields with photo", () => {
  it("renders AccountPhotoField and caption above Your name", () => {
    const FormWrapper = () => {
      const form = useAccountForm();
      return <AccountFields form={form} />;
    };

    render(<FormWrapper />);

    expect(
      screen.getByText("Optional. You can add or change it later in Settings."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Choose a profile photo" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
  });

  it("updates photo in form state when setPhoto is called", async () => {
    let currentForm!: ReturnType<typeof useAccountForm>;
    const FormWrapper = () => {
      const form = useAccountForm();
      currentForm = form;
      return <AccountFields form={form} />;
    };

    const { container } = render(<FormWrapper />);
    expect(currentForm.photo).toBeNull();

    const photoFile = new File(["img"], "me.png", { type: "image/png" });
    const fileInput = container.querySelector('input[type="file"]')!;
    fireEvent.change(fileInput, { target: { files: [photoFile] } });

    await waitFor(() => {
      expect(currentForm.photo).toBe(photoFile);
    });
  });
});
