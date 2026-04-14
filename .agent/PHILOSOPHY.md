# Product Philosophy

_This is the soul of the product. It explains why the app exists and what its core beliefs are. Product Visionaries and UI/UX Designers use this to make feature and design decisions. Engineers use it to resolve ambiguity._

## 1. Why This Exists
Contrack is a local-first, AI-powered personal CRM built for high-leverage individuals. Traditional CRMs are bloated and geared towards enterprise sales teams. Contrack exists to make maintaining relationships, organizing contacts, and recalling context completely effortless and instantaneous.

## 2. Target User
The target user is a power user or high-leverage individual who values extreme speed, keyboard-first navigation, and high information density. They want immediate access to their network intelligence without onboarding hurdles, bloated interfaces, or sacrificing their privacy.

## 3. Core Beliefs
- **Speed over features**: The system must feel instantaneous. 0ms client-side search cache and extremely fast local vector KNN retrieval are prioritized over heavy network operations.
- **Privacy is non-negotiable**: Local-first architecture (SQLite, local embeddings) ensures that contact data remains strictly on the device unless an explicit AI briefing requires calling an LLM.
- **Keyboard-first Navigation**: Interactions should center around a powerful Command Palette (Cmd+K) allowing for navigation, searching, and taking action without moving the mouse.

## 4. Design & UX Principles
- **Information Density**: The UI must be compact and efficient.
- **Subtle Containment**: Use visual shifts in surface colors (Tailwind token system) rather than hard borders to organize information.
- **Intelligence at your Fingertips**: Utilize AI passively (e.g., Executive Brief streamer, automatic Doc2Query search expansion) to augment the user's recall, rather than acting as a chat bot.

## 5. What This Is NOT
- **Not a B2B SaaS tool**: There are no "leads", "pipelines", or "conversion tracking" metrics.
- **Not a cloud-hosted DB**: Data lives on disk locally.
- **Not a generic task manager**: Focus is specifically on relationships and contact context.