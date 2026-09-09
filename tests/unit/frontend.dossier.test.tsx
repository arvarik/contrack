// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DossierTab } from "../../src/views/contact-detail/components/DossierTab";
import type { Contact } from "../../src/types";
afterEach(cleanup);
describe("research notes", () => {
  it("shows research-only dossiers and opens sources without replacing the app", () => {
    render(
      <DossierTab
        contact={
          {
            id: "test",
            name: "Test",
            aiBackground:
              "Research notes.\n\n[Source](https://example.com/research)",
          } as Contact
        }
      />,
    );
    expect(screen.getByText("Research notes and sources")).toBeTruthy();
    const source = screen.getByRole("link", { name: "Source", hidden: true });
    expect(source.getAttribute("href")).toBe("https://example.com/research");
    expect(source.getAttribute("rel")).toBe("noopener noreferrer");
    expect(source.getAttribute("target")).toBe("_blank");
  });
  it("blocks embedded HTML, remote images, and unsafe source schemes", () => {
    const { container } = render(
      <DossierTab
        contact={
          {
            id: "test",
            name: "Test",
            aiBackground:
              "<script>alert(1)</script>\n\n![tracking](https://example.com/image)\n\n[Unsafe](javascript:alert(1))",
          } as Contact
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
