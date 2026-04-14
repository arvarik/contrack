# Testing Strategy & Results

_This file tracks test methods, scenarios, and results with concrete execution evidence. Bugs found here block the release of a feature. Agents must update this during the Test and Fix phases._

## 0. Local Development Setup
### Prerequisites
- Node.js 22+
- npm

### Start the App
1. Copy `.env.example` to `.env` and set your `GEMINI_API_KEY`.
2. Run `npm install`.
3. Run `npm run dev`. This starts the Express backend via `tsx` and the Vite React 19 frontend.

### Seed / Reset Data
- Run `npm run seed` to drop the current SQLite database and repopulate it with synthetic demo data.

### Database
- Local SQLite database. No external database server is required.

## 1. Test Methods & Tools
- **Run all tests (Watch Mode)**: `npm test`
- **Run all tests (Single Pass)**: `npx vitest run` (Executes ~72 Vitest tests in <500ms)
- **Type Checking**: `npm run lint` (runs `tsc --noEmit`)

## 2. Execution Evidence Rules
_Never mark a test as PASS without evidence._
- For automated tests, paste the output of `npx vitest run`.
- For type checking, paste the output of `npm run lint`.
- "PASS" with no evidence is treated as UNTESTED.

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