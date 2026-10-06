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

  it("refuses a file over 10 MB in words tied to the field, then takes a valid one", async () => {
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
    const oversized = new File(["a"], "too-big.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [oversized] } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Image must be under 10 MB",
      );
    });
    for (const el of [fileInput, dropzone]) {
      expect(el.getAttribute("aria-describedby")).toBe("account-photo-error");
    }
    expect(onChange).not.toHaveBeenCalled();

    const valid = new File(["ok"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [valid] } });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(valid);
      expect(screen.queryByRole("alert")).toBeNull();
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

  it("keeps the account when the photo fails, and says so", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(uploadAccountAvatar).mockRejectedValue(
      new Error("Upload failed"),
    );
    const photo = new File(["bytes"], "photo.png", { type: "image/png" });

    await expect(createAccountThenPhoto(submit, photo)).resolves.toEqual({
      photoFailed: true,
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("rethrows a failed submit and uploads nothing", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("Submit failed"));
    const photo = new File(["bytes"], "photo.png", { type: "image/png" });

    await expect(createAccountThenPhoto(submit, photo)).rejects.toThrow(
      "Submit failed",
    );
    expect(uploadAccountAvatar).not.toHaveBeenCalled();
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
