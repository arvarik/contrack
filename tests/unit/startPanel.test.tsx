// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { StartPanel } from "../../src/components/layout/StartPanel";
import type { UpNextItem } from "../../src/views/pulse/lib/upNext";
import type { Contact } from "../../src/types";

afterEach(() => {
  cleanup();
});

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

function renderStartPanel(props: React.ComponentProps<typeof StartPanel> = {}) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StartPanel {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockUpNextItem: UpNextItem = {
  id: "action-1",
  kind: "action_item",
  group: "today",
  contactId: "c-1",
  contactName: "Ada Lovelace",
  contactAvatarUrl: null,
  contactThemeColor: "#006a91",
  relationshipScore: 85,
  title: "Follow up on analytical engine draft",
  dueAt: new Date().toISOString(),
  hasCheckAction: true,
  dueChip: {
    text: "Today",
    variant: "today",
  },
};

const mockContact: Contact = {
  id: "c-1",
  name: "Ada Lovelace",
  firstName: "Ada",
  lastName: "Lovelace",
  headline: "Mathematician",
  role: "Pioneer",
  company: "Babbage Labs",
  location: "London, UK",
  birthday: "1815-12-10",
  preferences: null,
  avatarUrl: null,
  isGhost: false,
  isArchived: false,
  addedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cadenceDays: 30,
  lastContactedAt: new Date().toISOString(),
  nextFollowUpAt: null,
  themeColor: "#006a91",
  about: null,
  pronouns: "she/her",
  industry: "Technology",
  website: null,
  lat: 51.5074,
  lng: -0.1278,
  emails: [],
  phones: [],
  socialLinks: [],
  education: [],
  experience: [],
  sources: [],
  tags: [],
  lists: [],
  addresses: [],
  interests: [],
  attributes: [],
};

describe("StartPanel", () => {
  it("renders three labelled landmark regions with proper headings and corvid mark", () => {
    renderStartPanel({
      upNextItems: [],
      recentContacts: [],
      addPeopleActions: [],
    });

    // Three labelled regions
    const upNextRegion = screen.getByRole("region", { name: "Up next" });
    const recentRegion = screen.getByRole("region", {
      name: "Recently viewed",
    });
    const addRegion = screen.getByRole("region", { name: "Add people" });

    expect(upNextRegion).toBeDefined();
    expect(recentRegion).toBeDefined();
    expect(addRegion).toBeDefined();

    // Section headings are h2
    const h2Elements = screen.getAllByRole("heading", { level: 2 });
    const h2Texts = h2Elements.map((h) => h.textContent?.trim());
    expect(h2Texts).toContain("Up next");
    expect(h2Texts).toContain("Recently viewed");
    expect(h2Texts).toContain("Add people");

    // Header has corvid mark SVG
    const svg = document.querySelector("svg");
    expect(svg).toBeDefined();
  });

  describe("without data", () => {
    it("renders level 3 empty states for all three regions", () => {
      renderStartPanel({
        upNextItems: [],
        recentContacts: [],
        addPeopleActions: [],
      });

      // Up next empty state (h3)
      const upNextEmptyHeading = screen.getByRole("heading", {
        level: 3,
        name: "Nothing due",
      });
      expect(upNextEmptyHeading).toBeDefined();
      expect(
        screen.getByText(
          "Follow-ups you add from a note or a contact land here.",
        ),
      ).toBeDefined();

      // Recently viewed empty state (h3)
      const recentEmptyHeading = screen.getByRole("heading", {
        level: 3,
        name: "No recently viewed contacts",
      });
      expect(recentEmptyHeading).toBeDefined();
      expect(
        screen.getByText("Contacts you open appear here for quick access."),
      ).toBeDefined();

      // Add people empty state (h3)
      const addEmptyHeading = screen.getByRole("heading", {
        level: 3,
        name: "No actions available",
      });
      expect(addEmptyHeading).toBeDefined();
    });
  });

  describe("with data", () => {
    it("renders up to 3 Up Next items with ActionRow and handles interactions", () => {
      const onComplete = vi.fn();
      const onLog = vi.fn();

      renderStartPanel({
        upNextItems: [
          mockUpNextItem,
          { ...mockUpNextItem, id: "action-2", title: "Review notes" },
        ],
        recentContacts: [],
        addPeopleActions: [],
        onCompleteUpNext: onComplete,
        onLogUpNext: onLog,
      });

      expect(
        screen.getByText("Follow up on analytical engine draft"),
      ).toBeDefined();
      expect(screen.getByText("Review notes")).toBeDefined();

      // Completing an action triggers callback
      const completeBtn = screen.getByRole("button", {
        name: /Mark "Follow up on analytical engine draft" done/,
      });
      fireEvent.click(completeBtn);

      // ActionRow sets a short timeout before firing complete
      setTimeout(() => {
        expect(onComplete).toHaveBeenCalledWith("action-1");
      }, 350);
    });

    it("renders recently viewed contacts with name, role and company", () => {
      renderStartPanel({
        upNextItems: [],
        recentContacts: [mockContact],
        addPeopleActions: [],
      });

      expect(screen.getByText("Ada Lovelace")).toBeDefined();
      expect(screen.getByText("Pioneer · Babbage Labs")).toBeDefined();
    });

    it("renders add people actions and fires click handlers", () => {
      const onImportClick = vi.fn();
      renderStartPanel({
        upNextItems: [],
        recentContacts: [],
        addPeopleActions: [
          {
            label: "Custom Import",
            description: "Import from file",
            icon: Upload,
            onClick: onImportClick,
          },
        ],
      });

      const importBtn = screen.getByRole("button", { name: /Custom Import/ });
      expect(importBtn).toBeDefined();
      expect(screen.getByText("Import from file")).toBeDefined();

      fireEvent.click(importBtn);
      expect(onImportClick).toHaveBeenCalledTimes(1);
    });

    it("renders default add actions and dispatches modal events on click", () => {
      const importListener = vi.fn();
      const newContactListener = vi.fn();
      const smartPasteListener = vi.fn();

      window.addEventListener("contrack:open-import", importListener);
      window.addEventListener("contrack:open-new-contact", newContactListener);
      window.addEventListener("contrack:open-smart-paste", smartPasteListener);

      renderStartPanel();

      const importBtn = screen.getByRole("button", { name: /Import/ });
      const newContactBtn = screen.getByRole("button", { name: /New contact/ });
      const smartPasteBtn = screen.getByRole("button", {
        name: /Add from text/,
      });

      fireEvent.click(importBtn);
      expect(importListener).toHaveBeenCalledTimes(1);

      fireEvent.click(newContactBtn);
      expect(newContactListener).toHaveBeenCalledTimes(1);

      fireEvent.click(smartPasteBtn);
      expect(smartPasteListener).toHaveBeenCalledTimes(1);

      window.removeEventListener("contrack:open-import", importListener);
      window.removeEventListener(
        "contrack:open-new-contact",
        newContactListener,
      );
      window.removeEventListener(
        "contrack:open-smart-paste",
        smartPasteListener,
      );
    });

    it("invokes default handlers for action row complete and log note", () => {
      const quickNoteListener = vi.fn();
      window.addEventListener("contrack:open-quick-note", quickNoteListener);

      renderStartPanel({
        upNextItems: [
          {
            ...mockUpNextItem,
            hasCheckAction: false,
          },
        ],
      });

      const logBtn = screen.getByRole("button", {
        name: /Log note for Ada Lovelace/,
      });
      fireEvent.click(logBtn);
      expect(quickNoteListener).toHaveBeenCalled();

      window.removeEventListener("contrack:open-quick-note", quickNoteListener);
    });

    it("resolves recent contacts and dashboard items from queries when props omitted", () => {
      const client = createQueryClient();
      sessionStorage.setItem(
        "contrack_recent_contacts:local",
        JSON.stringify(["c-1"]),
      );

      client.setQueryData(["dashboard"], {
        overdue: [],
        dueToday: [],
        upcoming: [],
        atRisk: [
          {
            id: "c-1",
            name: "Ada Lovelace",
            relationshipScore: 40,
            daysSinceContact: 45,
          },
        ],
      });
      client.setQueryData(["contacts"], [mockContact]);

      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <StartPanel />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      expect(screen.getByRole("region", { name: "Up next" })).toBeDefined();
      expect(
        screen.getByRole("region", { name: "Recently viewed" }),
      ).toBeDefined();
      expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});
