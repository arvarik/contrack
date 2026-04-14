# Product Philosophy

_This is the soul of the product. It explains why the app exists and what its core beliefs are. Product Visionaries and UI/UX Designers use this to make feature and design decisions. Engineers use it to resolve ambiguity._

## 1. Why This Exists
Contrack is a local-first, AI-powered personal CRM built for high-leverage individuals (creative directors, executives, contractors). Traditional CRMs are bloated log-books requiring immense manual input for enterprise funnels. Contrack works differently: **You write the notes, the AI builds the relational graph.** We convert chaotic unstructured interactions into deep intelligence without manual forms.

## 2. Target User Concept
The power user values rapid recall, keyboard-first navigation, and immediate insight extraction over complex pipelines. They prefer to pull up a contact dynamically via `Cmd+K` during a live meeting rather than navigating heavy multi-page dashboards.

## 3. Core Beliefs
- **0ms Doctrine**: Latency breaks flow. Client-side caching, FTS5 SQL lookups, local vector embeddings via Transformers.js, and multi-phase NDJSON rendering ensure instantaneous interactions masking any larger structural LLM latency.
- **Ghost Entity Mapping**: The AI passively processes raw text, discovering references to individuals even before users officially log them. These "Ghost" nodes materialize into formal contacts automatically once active engagement unfolds, ensuring history is never lost purely due to delayed data entry.
- **Privacy Is Fundamental**: Core storage (SQLite) is local. AI network boundaries are restricted to explicit features (like Catch-Me-Up briefings or data enrichments) using intelligent model adapters that conserve outbound tokens.

## 4. Design & UX Principles
- **No-Line Hierarchy**: Lines signify a failure of visual hierarchy. Containment is expressed purely through surface background shifts (`bg-surface`, `bg-surface-container-low`, etc.) rather than rigid borders. 
- **Glassmorphism Integration**: Modals and floating elements utilize robust blur filters and transparency stacks to represent contextual dominance over underlying text.
- **Progressive Intelligence**: Utilize background processing (e.g., automated chronological score sorting, passive Doc2Query search expansions) to quietly arm users with relevant insights. Intelligence should feel ambient, not interventional.

## 5. What This Is NOT
- **Not a sales tracker**: No traditional leads, conversion pipelines, CRM workflows, or financial metrics.
- **Not an Enterprise DB**: Database rests strictly isolated on disk, refusing connection with cloud environments.
- **Not a raw task manager**: Tasks exist strictly as contextual offshoots of relationships (`action_items`), not a daily planner.