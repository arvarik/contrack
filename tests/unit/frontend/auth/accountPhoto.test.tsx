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
import { AccountAvatar } from "../../../../src/components/auth/AccountIdentity";
import { AccountPhotoField } from "../../../../src/components/auth/AccountPhotoField";
import {
  AccountFields,
  createAccountThenPhoto,
  useAccountForm,
} from "../../../../src/components/auth/accountForm";
import { uploadAccountAvatar } from "../../../../src/api/auth";

vi.mock("../../../../src/api/auth", () => ({
  uploadAccountAvatar: vi.fn(),
}));

describe("AccountAvatar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
    const oversized = new File(["a".repeat(100)], "too-big.png", {
      type: "image/png",
    });
    Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });
    const validFile = new File(["valid image content"], "photo.jpg", {
      type: "image/jpeg",
    });

    // An error first, so the valid file has one to clear.
    fireEvent.change(input, { target: { files: [oversized] } });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    fireEvent.change(input, {
      target: { files: [validFile] },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(validFile);
      expect(screen.queryByRole("alert")).toBeNull();
    });
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
    onRemove.mockClear();
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
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("rejects a file over 10 MB with inline text, linked by aria-describedby on the dropzone and the input", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <AccountPhotoField
        value={null}
        fallbackUrl="/fallback.png"
        onChange={onChange}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]')!;
    const dropzone = screen.getByRole("button", {
      name: "Choose a profile photo",
    });
    expect(fileInput.getAttribute("aria-describedby")).toBeNull();
    expect(dropzone.getAttribute("aria-describedby")).toBeNull();

    const oversized = new File(["a".repeat(100)], "too-big.png", {
      type: "image/png",
    });
    Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [oversized] } });

    await waitFor(() => {
      const errorElem = screen.getByRole("alert");
      expect(errorElem.textContent).toBe("Image must be under 10 MB");
      expect(errorElem.id).toBe("account-photo-error");
      expect(fileInput.getAttribute("aria-describedby")).toBe(
        "account-photo-error",
      );
      expect(dropzone.getAttribute("aria-describedby")).toBe(
        "account-photo-error",
      );
    });
    expect(onChange).not.toHaveBeenCalled();
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

    const photo = screen.getByRole("button", {
      name: "Choose a profile photo",
    });
    const caption = screen.getByText(
      "Optional. You can add or change it later in Settings",
    );
    const name = screen.getByLabelText("Your name");
    expect(
      photo.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      caption.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the photo circle before the account exists", () => {
  afterEach(() => cleanup());

  // The setup, register and join screens have no session, and the avatar
  // route sits behind the sign-in gate: an `<img>` of `/api/avatar/initials`
  // got a 401 there and showed a broken image.
  it("draws the monogram in the page, with no request to the avatar route", () => {
    const FormWrapper = () => {
      const form = useAccountForm();
      return <AccountFields form={form} />;
    };
    const { container } = render(<FormWrapper />);

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Ada Lovelace" },
    });

    const src = container.querySelector("img")!.getAttribute("src")!;
    expect(src.startsWith("data:image/svg+xml")).toBe(true);
    expect(src).not.toContain("/api/avatar/");
    const svg = decodeURIComponent(src.slice(src.indexOf(",") + 1));
    expect(svg).toContain(">AL</text>");
  });
});
