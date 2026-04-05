# Contributing to Contrack

Thank you for your interest in contributing to Contrack! This guide outlines the standards and workflow for participating in the project.

## Getting Started

1. Fork the repository and clone your fork
2. Install dependencies with `npm install`
3. Copy `.env.example` to `.env` and configure your API keys
4. Run `npm run dev` to start the development server

## Development Standards

### Code Style

- **TypeScript**: All code must be strictly typed. Usage of `any` is prohibited outside of edge-case type narrowing.
- **React Query**: All frontend data fetching must go through `@tanstack/react-query` hooks. Raw `useEffect` fetch loops are not acceptable.
- **Styling**: Use Tailwind CSS v4 utility classes following the design system defined in `.agent/workflows/design-system.md`. Do not use raw borders — containment is expressed through surface background shifts (`surface`, `surface-container-low`, `surface-container-lowest`).

### Architecture

- **Frontend** (`src/`): React 19 with Vite. Components live in `src/components/`, views in `src/views/`, and API hooks in `src/api/`.
- **Backend** (`server/`): Express with a layered architecture: `routes/` → `services/` → `repositories/`. The AI subsystem uses a provider adapter pattern under `server/ai/`.
- **Database**: SQLite via Drizzle ORM. Schema is defined in `src/db/schema.ts`. After any schema change, run `npm run db:generate` to create a tracked migration.

### Commit Messages

Use clear, descriptive commit messages. Prefix with the area of the codebase:

```
feat(contacts): add multi-value address field
fix(timeline): prevent duplicate mention extraction
refactor(ai): extract provider adapter interface
docs: update API endpoint table in README
```

## Pull Request Process

1. Ensure your branch is up to date with `main`
2. Run `npm run lint` and `npm run build` — both must pass
3. Describe **what** changed and **why** in the PR description
4. If your change modifies the API surface, update the README's API table
5. If your change modifies the database schema, include the migration file

## Reporting Issues

When opening an issue, please include:

- Steps to reproduce
- Expected vs. actual behavior
- Node.js version and OS
- Relevant console output or error messages
