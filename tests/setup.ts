import { vi } from "vitest";

// Mock DB to prevent accidental disk writes during unit tests
vi.mock("../server/db.ts", () => ({
  sqlite: {
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })),
    exec: vi.fn(),
    transaction: vi.fn((cb) => cb),
  },
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
