// @vitest-environment jsdom
// How the audit log reads a failed SSO sign-in: no account, a disabled
// account, an account that must change its password first.

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const entry = (id: number, actor: unknown, details: unknown) => ({
  id,
  action: "auth.login.failed",
  actor,
  targetType: null,
  targetId: null,
  details,
  ip: "127.0.0.1",
  createdAt: "2026-10-16T00:00:00Z",
});

vi.mock("../../../../src/api/admin", () => ({
  AUDIT_GROUPS: [],
  useAuditLog: () => ({
    data: {
      pages: [
        {
          entries: [
            entry(1, null, { method: "oidc", matched: false }),
            entry(
              2,
              { id: "u", username: "mira" },
              {
                method: "oidc",
                reason: "disabled",
              },
            ),
            entry(
              3,
              { id: "v", username: "ada" },
              {
                method: "oidc",
                reason: "must-change-password",
              },
            ),
          ],
          nextCursor: null,
        },
      ],
    },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

import { AuditView } from "../../../../src/views/settings/admin/AuditView";

afterEach(cleanup);

describe("AuditView failed SSO sign-ins", () => {
  it("names the cause of each", () => {
    render(
      <MemoryRouter>
        <AuditView />
      </MemoryRouter>,
    );
    expect(screen.getByText("for an SSO sign-in with no account")).toBeTruthy();
    expect(screen.getByText("by mira")).toBeTruthy();
    expect(screen.getByText("SSO · account disabled")).toBeTruthy();
    expect(screen.getByText("by ada")).toBeTruthy();
    expect(screen.getByText("SSO · must change password")).toBeTruthy();
  });
});
