// @vitest-environment jsdom
/**
 * The Connect settings section: the connector forms, Correspondents, the MCP
 * page and the section's search keywords.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { CalendarFormModal } from "../../../../src/views/settings/connectors/CalendarFormModal";
import { CarddavFormModal } from "../../../../src/views/settings/connectors/CarddavFormModal";
import { GoogleFormModal } from "../../../../src/views/settings/connectors/GoogleFormModal";
import { ImapFormModal } from "../../../../src/views/settings/connectors/ImapFormModal";
import { CorrespondentsView } from "../../../../src/views/settings/connectors/CorrespondentsView";
import { McpView } from "../../../../src/views/settings/mcp/McpView";
import { findRows } from "../../../../src/views/settings/registry";
import * as connectorsApi from "../../../../src/api/connectors";
import * as contactsApi from "../../../../src/api/contacts";
import * as authApi from "../../../../src/api/auth";
import * as authGate from "../../../../src/components/auth/AuthGate";
import type {
  ConnectorSummary,
  Correspondent,
  KindInfo,
} from "../../../../shared/connectors";

vi.mock("../../../../src/api/connectors", () => ({
  useConnectorKinds: vi.fn(),
  useConnectors: vi.fn(),
  useCreateConnector: vi.fn(),
  useTestConnector: vi.fn(),
  useUpdateConnector: vi.fn(),
  useDeleteConnector: vi.fn(),
  useSyncConnector: vi.fn(),
  useConnectorRuns: vi.fn(),
  useCorrespondents: vi.fn(),
  useIgnoreCorrespondent: vi.fn(),
}));

vi.mock("../../../../src/api/contacts", () => ({
  useCreateContact: vi.fn(),
}));

vi.mock("../../../../src/api/auth", () => ({
  createApiToken: vi.fn(),
}));

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Gives a mocked mutation hook this `mutateAsync`, and returns it. */
function mutation<T extends ReturnType<typeof vi.fn>>(
  hook: (...args: never[]) => unknown,
  mutateAsync: T,
): T {
  vi.mocked(hook).mockReturnValue({ mutateAsync, isPending: false });
  return mutateAsync;
}

/** The kinds the server lists, with Google configured or not. */
function kinds(googleConfigured: boolean) {
  const list: KindInfo[] = [
    {
      kind: "imap",
      label: "Mailbox (IMAP)",
      description: "Sync sent and received mail headers from any IMAP account",
      capabilities: { schedule: true },
    },
    {
      kind: "google",
      label: "Google Workspace",
      description: "Sync contacts, mail and calendar with Google",
      capabilities: { schedule: true, oauth: true },
      configured: googleConfigured,
    },
  ];
  vi.mocked(connectorsApi.useConnectorKinds).mockReturnValue({
    data: list,
    isLoading: false,
  } as unknown as ReturnType<typeof connectorsApi.useConnectorKinds>);
}

function correspondents(data: Correspondent[]) {
  vi.mocked(connectorsApi.useCorrespondents).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof connectorsApi.useCorrespondents>);
}

describe("Connect settings", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();

    vi.mocked(authGate.useAuth).mockReturnValue({
      user: { id: "u1", username: "admin", role: "admin", isOwner: true },
      token: "tok",
      role: "admin",
      isAdmin: true,
      isOwner: true,
      authRequired: true,
      publicUrl: "https://crm.example.com",
      mcpOAuth: false,
      needsSetup: false,
      login: vi.fn(),
      logout: vi.fn(),
    } as unknown as ReturnType<typeof authGate.useAuth>);

    kinds(true);
    mutation(
      connectorsApi.useCreateConnector,
      vi.fn().mockResolvedValue({ id: "conn-1" }),
    );
    mutation(
      connectorsApi.useUpdateConnector,
      vi.fn().mockResolvedValue({ id: "conn-1" }),
    );
    mutation(
      connectorsApi.useTestConnector,
      vi.fn().mockResolvedValue({ ok: true, detail: "Connected cleanly" }),
    );
    mutation(
      connectorsApi.useIgnoreCorrespondent,
      vi.fn().mockResolvedValue({ ok: true }),
    );
    mutation(
      contactsApi.useCreateContact,
      vi.fn().mockResolvedValue({ id: "c-1" }),
    );
    correspondents([]);
  });

  afterEach(() => {
    cleanup();
  });

  const renderWithProviders = (ui: React.ReactElement) =>
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </MemoryRouter>,
    );

  describe("CalendarFormModal", () => {
    it("normalizes webcal:// URLs to https://, clears stale test results on edit, and formats error toasts", async () => {
      const testMock = mutation(
        connectorsApi.useTestConnector,
        vi
          .fn()
          .mockResolvedValueOnce({ ok: true, detail: "Calendar feed verified" })
          .mockRejectedValueOnce(new Error("403 Forbidden.")),
      );

      renderWithProviders(
        <CalendarFormModal isOpen={true} onClose={vi.fn()} />,
      );

      const urlInput = screen.getByLabelText("Private ICS calendar URL");
      expect(urlInput.getAttribute("spellcheck")).toBe("false");
      expect(urlInput.getAttribute("autocorrect")).toBe("off");

      // Rejects invalid schemes
      fireEvent.change(urlInput, {
        target: { value: "ftp://example.com/cal.ics" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      expect(
        screen.getByText(
          "Enter a valid https://, http:// or webcal:// calendar URL",
        ),
      ).toBeTruthy();
      expect(testMock).not.toHaveBeenCalled();

      // Normalizes webcal:// to https://
      fireEvent.change(urlInput, {
        target: {
          value: "  webcal://p01-caldav.icloud.com/published/2/cal.ics  ",
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

      await waitFor(() => {
        expect(testMock).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "ics",
            config: expect.objectContaining({
              url: "https://p01-caldav.icloud.com/published/2/cal.ics",
            }),
          }),
        );
        expect(screen.getByText("Calendar feed verified")).toBeTruthy();
      });

      // Changing the URL clears the stale testResult banner
      fireEvent.change(urlInput, {
        target: { value: "https://example.com/other.ics" },
      });
      expect(screen.queryByText("Calendar feed verified")).toBeNull();

      // Error toast uses standardized "Could not test connection: ..." without trailing period
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Could not test connection: 403 Forbidden",
        );
      });
    });
  });

  describe("CarddavFormModal", () => {
    it("sets NO_AUTOCORRECT, trims URL and username while preserving password spaces, and validates URL scheme", async () => {
      const createMock = mutation(
        connectorsApi.useCreateConnector,
        vi.fn().mockResolvedValue({ id: "carddav-1" }),
      );
      mutation(
        connectorsApi.useTestConnector,
        vi.fn().mockResolvedValue({
          ok: true,
          detail: "Connected to Personal",
          addressBooks: [
            {
              url: "https://contacts.icloud.com/dav/personal/",
              displayName: "Personal",
            },
            {
              url: "https://contacts.icloud.com/dav/work/",
              displayName: "Work",
            },
          ],
        }),
      );

      const onClose = vi.fn();
      renderWithProviders(<CarddavFormModal isOpen={true} onClose={onClose} />);

      const urlInput = screen.getByLabelText("Server or address book URL");
      const userInput = screen.getByLabelText("Username / email");
      const passInput = screen.getByLabelText("App password");

      expect(urlInput.getAttribute("autocorrect")).toBe("off");
      expect(userInput.getAttribute("autocorrect")).toBe("off");
      expect(passInput.getAttribute("autocorrect")).toBe("off");

      fireEvent.change(urlInput, {
        target: { value: "ftp://contacts.icloud.com" },
      });
      fireEvent.change(userInput, {
        target: { value: "  ada@example.com  " },
      });
      fireEvent.change(passInput, {
        target: { value: "   " },
      });

      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(
        screen.getByText("Enter a valid https:// or http:// server URL"),
      ).toBeTruthy();
      expect(createMock).not.toHaveBeenCalled();

      fireEvent.change(urlInput, {
        target: { value: "  https://contacts.icloud.com  " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(screen.getByText("Enter your app password")).toBeTruthy();

      fireEvent.change(passInput, {
        target: { value: "abcd-efgh-ijkl-mnop " },
      });

      // Test connection returning 2 address books shows the Address book selector,
      // and changing the server URL clears the stale addressBookUrl selection
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      await waitFor(() => {
        expect(screen.getByLabelText("Address book")).toBeTruthy();
      });

      // Changing the URL to a different host clears the discovered address books
      // and clears the chosen addressBookUrl so stale URLs are not submitted
      fireEvent.change(urlInput, {
        target: { value: "https://cloud.example.com" },
      });
      expect(screen.queryByLabelText("Address book")).toBeNull();
      fireEvent.change(urlInput, {
        target: { value: "  https://contacts.icloud.com  " },
      });

      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledWith({
          kind: "carddav",
          name: "Personal Contacts",
          config: {
            url: "https://contacts.icloud.com",
            username: "ada@example.com",
            syncDirection: "two_way",
          },
          secret: { password: "abcd-efgh-ijkl-mnop " },
          intervalMinutes: 30,
        });
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("preserves pushExistingContacts and same-origin addressBookUrl when editing a connector", async () => {
      const updateMock = mutation(
        connectorsApi.useUpdateConnector,
        vi.fn().mockResolvedValue({ id: "carddav-edit-1" }),
      );

      renderWithProviders(
        <CarddavFormModal
          isOpen={true}
          onClose={vi.fn()}
          connector={{
            id: "carddav-edit-1",
            kind: "carddav",
            name: "Work CardDAV",
            status: "active",
            secretPresent: true,
            intervalMinutes: 30,
            lastRunAt: null,
            nextRunAt: null,
            lastError: null,
            createdAt: "2026-10-16T00:00:00Z",
            updatedAt: "2026-10-16T00:00:00Z",
            config: {
              url: "https://contacts.icloud.com",
              username: "ada@example.com",
              syncDirection: "two_way",
              addressBookUrl: "https://contacts.icloud.com/dav/work/",
              pushExistingContacts: true,
            },
          }}
        />,
      );

      // Editing username or a same-origin URL keeps the configured addressBookUrl and pushExistingContacts
      fireEvent.change(screen.getByLabelText("Username / email"), {
        target: { value: "augusta@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Server or address book URL"), {
        target: { value: "https://contacts.icloud.com/dav" },
      });

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledWith({
          id: "carddav-edit-1",
          name: "Work CardDAV",
          config: {
            url: "https://contacts.icloud.com/dav",
            username: "augusta@example.com",
            syncDirection: "two_way",
            addressBookUrl: "https://contacts.icloud.com/dav/work/",
            pushExistingContacts: true,
          },
          secret: undefined,
          intervalMinutes: 30,
        });
      });
    });
  });

  describe("ImapFormModal", () => {
    it("validates missing host, username, and password", async () => {
      renderWithProviders(<ImapFormModal isOpen={true} onClose={vi.fn()} />);

      const saveBtn = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText("Enter the IMAP server's host")).toBeTruthy();
      });

      fireEvent.change(screen.getByPlaceholderText("imap.fastmail.com"), {
        target: { value: "imap.fastmail.com" },
      });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(
          screen.getByText("Enter your IMAP username or email"),
        ).toBeTruthy();
      });

      fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
        target: { value: "you@example.com" },
      });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText("Enter your app password")).toBeTruthy();
      });
    });

    it("tests IMAP connection when test button clicked", async () => {
      const testMutation = mutation(
        connectorsApi.useTestConnector,
        vi.fn().mockResolvedValue({
          ok: true,
          detail: "Found 150 emails in INBOX",
        }),
      );

      renderWithProviders(<ImapFormModal isOpen={true} onClose={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText("imap.fastmail.com"), {
        target: { value: "imap.fastmail.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
        target: { value: "you@example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("Paste your app password"), {
        target: { value: "app-secret-pwd" },
      });

      const testBtn = screen.getByRole("button", { name: "Test connection" });
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(testMutation).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Found 150 emails in INBOX")).toBeTruthy();
      });
    });

    it("creates the connector with NO_AUTOCORRECT fields, a bare host, a checked port and the password's spaces kept", async () => {
      const createMock = mutation(
        connectorsApi.useCreateConnector,
        vi.fn().mockResolvedValue({ id: "imap-1" }),
      );

      const onClose = vi.fn();
      renderWithProviders(<ImapFormModal isOpen={true} onClose={onClose} />);

      const hostInput = screen.getByLabelText("IMAP host");
      const portInput = screen.getByLabelText("Port");
      const userInput = screen.getByLabelText("Username / email");
      const passInput = screen.getByLabelText("App password");
      const foldersInput = screen.getByLabelText("Folders to sync");
      const aliasesInput = screen.getByLabelText(
        "Also treat these addresses as mine",
      );

      for (const el of [
        hostInput,
        userInput,
        passInput,
        foldersInput,
        aliasesInput,
      ]) {
        expect(el.getAttribute("autocorrect")).toBe("off");
      }

      fireEvent.change(hostInput, {
        target: { value: "  imaps://imap.fastmail.com/  " },
      });
      fireEvent.change(portInput, { target: { value: "70000" } });
      fireEvent.change(userInput, {
        target: { value: "  ada@fastmail.com  " },
      });
      fireEvent.change(passInput, { target: { value: "app-pass-123 " } });

      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(
        screen.getByText("Enter a valid port between 1 and 65535"),
      ).toBeTruthy();
      expect(createMock).not.toHaveBeenCalled();

      fireEvent.change(portInput, { target: { value: "993" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "imap",
            name: "Personal Mail",
            config: expect.objectContaining({
              host: "imap.fastmail.com",
              port: 993,
              username: "ada@fastmail.com",
            }),
            secret: { password: "app-pass-123 " },
          }),
        );
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe("GoogleFormModal", () => {
    it("renders Google Workspace modal when configured", () => {
      renderWithProviders(<GoogleFormModal isOpen={true} onClose={vi.fn()} />);

      expect(
        screen.getByRole("heading", { name: /Connect Google Workspace/i }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Connect Google Workspace/i }),
      ).toBeTruthy();
      expect(
        screen.getByText(/Summaries require reading email message bodies/i),
      ).toBeTruthy();
    });

    it("displays prompt to configure Google OAuth if instance is unconfigured", () => {
      kinds(false);
      const Where = () => {
        const location = useLocation();
        return <output>{location.pathname + location.hash}</output>;
      };
      renderWithProviders(
        <>
          <GoogleFormModal isOpen={true} onClose={vi.fn()} />
          <Where />
        </>,
      );

      expect(
        screen.getByText(/Google is not set up on this server yet/i),
      ).toBeTruthy();
      // To the row itself, which scrolls into view and flashes: the section
      // anchor left the page at its top.
      fireEvent.click(screen.getByText("Set up Google"));
      // The open dialog hides the rest of the page from the tree.
      expect(screen.getByRole("status", { hidden: true }).textContent).toBe(
        "/settings/admin/general#google-oauth",
      );
    });

    it("offers no Google sign-in to a connector that needs it while the server has no client", () => {
      kinds(false);
      const connector: ConnectorSummary = {
        id: "g1",
        kind: "google",
        name: "Google (me@example.com)",
        status: "needs_reauth",
        config: {},
        secretPresent: true,
        intervalMinutes: 30,
        nextRunAt: null,
        lastRunAt: null,
        lastError: null,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      };

      renderWithProviders(
        <GoogleFormModal
          isOpen={true}
          onClose={vi.fn()}
          connector={connector}
        />,
      );

      expect(
        screen.getByText(/Google is not set up on this server yet/i),
      ).toBeTruthy();
      expect(screen.queryByText("Reconnect with Google")).toBeNull();
    });
  });

  describe("CorrespondentsView", () => {
    it("renders empty state when no correspondents exist", () => {
      renderWithProviders(<CorrespondentsView />);

      expect(screen.getByText("No one to review")).toBeTruthy();
      expect(
        screen.getByText(/When a connector syncs mail or meetings/i),
      ).toBeTruthy();
    });

    /** Renders the one correspondent, and returns its two mutations. */
    const renderCorrespondents = () => {
      correspondents([
        {
          connectorId: "conn-1",
          connectorName: "Work Email",
          kind: "imap",
          externalId: "alice@partner.org",
          name: "Alice Partner",
          email: "alice@partner.org",
          phone: undefined,
          seenCount: 5,
          lastSeenAt: new Date().toISOString(),
          localId: null,
          ignoredAt: null,
        },
      ]);
      const createContactMock = mutation(
        contactsApi.useCreateContact,
        vi.fn().mockResolvedValue({ id: "c-123" }),
      );
      const ignoreMock = mutation(
        connectorsApi.useIgnoreCorrespondent,
        vi.fn().mockResolvedValue({ ok: true }),
      );
      renderWithProviders(<CorrespondentsView />);
      return { createContactMock, ignoreMock };
    };

    it("renders correspondents list, and Add as contact creates the contact and marks the correspondent", async () => {
      const { createContactMock, ignoreMock } = renderCorrespondents();

      expect(screen.getByText("Alice Partner")).toBeTruthy();
      expect(screen.getByText("alice@partner.org")).toBeTruthy();

      const addBtn = screen.getByRole("button", { name: /Add as contact/i });
      fireEvent.click(addBtn);

      await waitFor(() => {
        expect(createContactMock).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Alice Partner",
            emails: [{ email: "alice@partner.org", label: "work" }],
          }),
        );
      });

      // Adding also marks the correspondent, so the row leaves the list.
      await waitFor(() => {
        expect(ignoreMock).toHaveBeenCalledWith({
          connectorId: "conn-1",
          externalId: "alice@partner.org",
        });
      });
      expect(ignoreMock).toHaveBeenCalledTimes(1);
    });

    it("Ignore marks the correspondent without creating a contact", async () => {
      const { createContactMock, ignoreMock } = renderCorrespondents();

      const ignoreBtn = screen.getByRole("button", { name: /Ignore/i });
      fireEvent.click(ignoreBtn);

      await waitFor(() => {
        expect(ignoreMock).toHaveBeenCalledWith({
          connectorId: "conn-1",
          externalId: "alice@partner.org",
        });
      });
      expect(ignoreMock).toHaveBeenCalledTimes(1);
      expect(createContactMock).not.toHaveBeenCalled();
    });

    it("shows filter box when >5 correspondents exist and prompts for name with NO_AUTOCORRECT when name is missing", async () => {
      correspondents(
        Array.from({ length: 6 }, (_, i) => ({
          connectorId: "conn-1",
          connectorName: "Fastmail",
          kind: "imap",
          externalId: `person${i}@example.com`,
          name: i === 0 ? undefined : `Person ${i}`,
          email:
            i === 0 ? "rowan.vale+news@example.com" : `person${i}@example.com`,
          seenCount: i + 2,
          lastSeenAt: "2026-10-15T12:00:00Z",
          localId: null,
          ignoredAt: null,
        })),
      );

      renderWithProviders(<CorrespondentsView />);

      const filterInput = screen.getByRole("textbox", {
        name: "Filter correspondents",
      });
      expect(filterInput.getAttribute("autocorrect")).toBe("off");

      fireEvent.change(filterInput, { target: { value: "rowan" } });
      expect(screen.getByText("rowan.vale+news@example.com")).toBeTruthy();
      expect(screen.queryByText("Person 1")).toBeNull();

      // Clicking Add as contact on an address-only correspondent opens the name modal pre-filled
      fireEvent.click(screen.getByRole("button", { name: /Add as contact/i }));
      const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
      expect(nameInput.value).toBe("Rowan Vale");
      expect(nameInput.getAttribute("autocorrect")).toBe("off");
    });
  });

  describe("McpView", () => {
    it("validates pasted tokens, supports Escape to cancel, and formats token creation errors", async () => {
      vi.mocked(authApi.createApiToken).mockRejectedValueOnce(
        new Error("Rate limit exceeded."),
      );

      renderWithProviders(<McpView />);

      expect(screen.getByText("https://crm.example.com/api/mcp")).toBeTruthy();

      // Create token failure uses standardized errorText toast
      fireEvent.click(
        screen.getByRole("button", { name: "Create a token for Claude Code" }),
      );
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Could not create token: Rate limit exceeded",
        );
      });

      // Paste existing token flow
      fireEvent.click(
        screen.getByRole("button", { name: "Use a token I have" }),
      );
      const tokenInput = screen.getByLabelText("Your token");
      expect(tokenInput.getAttribute("autocorrect")).toBe("off");

      // Invalid token shows error hint and keeps snippet placeholder
      fireEvent.change(tokenInput, { target: { value: "bad_token" } });
      expect(tokenInput.getAttribute("aria-invalid")).toBe("true");
      expect(
        screen.getByText(/A Contrack token starts with ctk_/i),
      ).toBeTruthy();

      // Valid token populates setup snippet
      const validToken = "ctk_1234567890abcdefghij12345";
      fireEvent.change(tokenInput, { target: { value: `  ${validToken}  ` } });
      expect(tokenInput.getAttribute("aria-invalid")).toBeNull();
      expect(screen.getByText(new RegExp(`Bearer ${validToken}`))).toBeTruthy();

      // Pressing Escape cancels pasting and resets token draft
      fireEvent.keyDown(tokenInput, { key: "Escape" });
      expect(screen.queryByLabelText("Your token")).toBeNull();
    });
  });

  describe("search keywords", () => {
    it.each([
      ["webcal", "/settings/connectors#gallery"],
      ["address book", "/settings/connectors#gallery"],
      ["strangers", "/settings/connectors/people"],
    ])("finds %s at %s", (query, expectedPath) => {
      const paths = findRows(query).map((h) => h.path);
      expect(paths).toContain(expectedPath);
    });

    it("does not match unsupported caldav or map non-Claude MCP clients to Claude rows", () => {
      expect(findRows("caldav")).toHaveLength(0);
      expect(findRows("vscode")).toHaveLength(0);
      expect(findRows("codex")).toHaveLength(0);
    });
  });
});
