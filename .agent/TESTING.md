# Testing Strategy & Results

_This file tracks test methods, scenarios, and results with concrete execution evidence. Bugs found here block the release of a feature. Agents must update this during the Test and Fix phases._

## 0. Local Development Setup
### Prerequisites
- Node.js 22+
- Valid `GEMINI_API_KEY` mapping in `.env`.

### Initialization
1. Ensure dependencies are clean `npm install`.
2. Generate synthetic data layers via `npm run seed`. This clears raw SQL instances, recreates schemas via explicit Drizzle migrations, and provides controlled fixture nodes.

## 1. Test Architecture Maps
Vitest isolates boundary complexities directly mapping onto functional logic points.

- **Unit Boundaries (`tests/unit/`)**: Asserts independent parsing routines, Vector KNN math formulas (`RRF` distribution algorithms), and NLP metrics without touching database layers.
- **Integration Boundaries (`tests/integration/`)**: Operates against true SQLite transactions validating deduplication, trigger cascades, and HTTP routing validations. 
- **AI Mock Requirements**: Ensure test setups targeting AI integrations inject the mocked `SmartRouter` context rather than emitting expensive production tokens during standard automated checks.

## 2. Test Execution Commands
- **Standard Run (Watch Mode)**: `npm test`
- **Instant Parallel Validation**: `npx vitest run` (Resolves native 72+ test block in <500ms).
- **TypeScript Integrity**: `npm run lint` guarantees strict payload architectures exist uniformly.

## 3. Execution Evidence Rules
_Never mark a test as PASS without evidence._
- Automate outputs via raw pasting of `npx vitest run` block completions.
- Submit `npm run lint` metrics as proof of stable compilation.
- "PASS" declarations absent execution artifacts must be designated as UNTESTED blocks.

---

## Current Feature Scenarios: Bootstrapped

| Scenario | Status | Notes (Evidence) |
|----------|--------|------------------|
| Empty/null/missing inputs | UNTESTED | |
| Valid payload creates resource | UNTESTED | |
| Invalid payload returns structured error | UNTESTED | |

## Bugs Found (Fix Phase Queue)
_List specific bugs discovered during testing._
1. None

---

## Regression Scenarios (Persistent)
| Scenario | Last Verified | Notes |
|----------|---------------|-------|
| _Type Check Passes_ | _YYYY-MM-DD_ | `npm run lint` yields 0 errors |
| _Vitest Suite Passes_ | _YYYY-MM-DD_ | `npx vitest run` passes all suites |