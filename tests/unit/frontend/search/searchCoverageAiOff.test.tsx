// @vitest-environment jsdom
// =============================================================================
// SearchCoverageBar — a hosted embedding model and an account with AI off
// =============================================================================
// A hosted model sends each contact to the provider, so the server does not
// index an account with AI off, and it refuses "Index missing" for one. The
// bar then offers nothing to press: the row under the search box stays away,
// and the card on the AI settings page says why its button is gone.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { SearchCoverageBar } from "../../../../src/views/search/SearchCoverageBar";
import type { SearchCoverage } from "../../../../src/api/search";

const state = vi.hoisted(() => ({ aiAllowed: true }));

vi.mock("../../../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => state.aiAllowed,
}));

/** Twenty contacts, none indexed yet, on a paid provider's model. */
const coverage: SearchCoverage = {
  total: 20,
  indexed: 0,
  missing: 20,
  pending: 0,
  failed: 0,
  coverage: 0,
  isIndexing: false,
  provider: {
    kind: "provider",
    providerId: "openai",
    model: "text-embedding-3-small",
    isPaid: true,
  },
  failedItems: [],
};

vi.mock("../../../../src/api", () => ({
  useSearchCoverage: () => ({ data: coverage, isLoading: false }),
  useRefreshSearchIndex: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const row = () =>
  screen.queryByRole("region", { name: "Semantic search coverage" });

afterEach(() => {
  cleanup();
  state.aiAllowed = true;
});

describe("SearchCoverageBar with a paid provider", () => {
  it("offers Index missing to an account with AI on", () => {
    render(<SearchCoverageBar variant="row" />);
    expect(row()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Index missing" })).toBeTruthy();
  });

  it("shows no row to an account with AI off", () => {
    state.aiAllowed = false;
    render(<SearchCoverageBar variant="row" />);
    expect(row()).toBeNull();
    expect(screen.queryByRole("button", { name: "Index missing" })).toBeNull();
  });

  it("says why the card has no button for an account with AI off", () => {
    state.aiAllowed = false;
    render(<SearchCoverageBar />);
    expect(screen.getByText(/AI is off for your account/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Index missing" })).toBeNull();
  });
});
