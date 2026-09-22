# MCP Server

Contrack exposes a Model Context Protocol (MCP) server that connects external LLM agents—such as Claude Code, Claude Desktop, and Cursor—directly to your personal CRM.

Access the interactive MCP setup page in Contrack under **Settings → Connect → MCP and API** (`/settings/mcp`).

---

## 1. Architecture

The MCP server runs in-process on Express using the official `@modelcontextprotocol/sdk`:

- **Endpoint**: `POST /api/mcp`
- **Transport**: `StreamableHTTPServerTransport` in stateless mode (`sessionIdGenerator: undefined`).
- **Method Enforcement**: `GET /api/mcp` and `DELETE /api/mcp` return `405 Method Not Allowed` with an `Allow: POST` header.
- **Authentication**: Requires a personal API token passed via `Authorization: Bearer ctk_...` (or legacy `API_TOKEN`). Unauthenticated requests receive `401 Unauthorized`.
- **Tenancy & Isolation**: Every request resolves the authenticated user into an explicit tenant `Scope`. All queries, writes, and searches are scoped to the caller's owner ID; cross-tenant access returns standard `NOT_FOUND` errors.
- **Rate Limiting**: 120 requests per minute per authenticated account. Exceeding this limit returns HTTP `429 Too Many Requests` with a `Retry-After: 60` response header.

---

## 2. Tools (15 Total)

All tools translate internal application errors into JSON-RPC error responses with preserved error codes.

### Read Tools

| Tool Name           | Description                                                                                                                                                         | Arguments                                                                                                                                                                                        |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_people`     | Fast search for people by name, company, title, or bio with facet filters.                                                                                          | `query` (string), `company` (optional), `role` (optional), `tag` (optional), `limit` (optional, 1–50)                                                                                            |
| `get_contact`       | Retrieve full contact profile. `scoreExplanation` is the five signals behind the score when the contact is tracked, and `null` when it is not. A read never writes. | `id` (UUID)                                                                                                                                                                                      |
| `list_contacts`     | List contacts with optional filtering and pagination.                                                                                                               | `limit` (optional, 1–100), `cursor` (optional), `role`, `company`, `industry` (optional), `updatedSince` (optional ISO 8601), `tracked` (optional boolean: the people the account keeps up with) |
| `get_timeline`      | Retrieve interactions and activity history for a contact.                                                                                                           | `contactId` (UUID), `limit` (optional, 1–50)                                                                                                                                                     |
| `search_notes`      | Full-text search across interaction notes and logged activity.                                                                                                      | `query` (string), `contactId` (optional UUID), `limit` (optional, 1–50)                                                                                                                          |
| `list_action_items` | List pending follow-ups filtered by urgency.                                                                                                                        | `contactId` (optional UUID), `due` (optional: overdue, today, week, all)                                                                                                                         |
| `get_pulse`         | Dashboard metrics: active contacts, the tracked contacts and their bands, the catch-ups past their cadence, and follow-ups.                                         | None                                                                                                                                                                                             |
| `list_tags`         | List all tags and contact counts across your network.                                                                                                               | None                                                                                                                                                                                             |
| `list_lists`        | List all contact lists and member counts.                                                                                                                           | None                                                                                                                                                                                             |

### Write Tools

| Tool Name              | Description                                         | Arguments                                                                                                                                                                                                  |
| :--------------------- | :-------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_contact`       | Create a new contact.                               | `name` (string), `company` (optional), `role` (optional), `email` (optional), `phone` (optional), `location` (optional), `tags` (optional string array)                                                    |
| `update_contact`       | Update contact properties, including tracking.      | `id` (UUID), `fields` (object: name, role, company, location, headline, about, industry, themeColor, `isTracked` to keep up with this person or stop, `cadenceDays` for how often: 30, 60, 90, 180 or 365) |
| `log_interaction`      | Log a meeting, email, note, or call with a contact. | `contactId` (UUID), `type` (meeting, email, call, note, etc.), `title` (string), `content` (optional), `date` (optional ISO 8601)                                                                          |
| `create_action_item`   | Create a follow-up action item for a contact.       | `contactId` (UUID), `title` (string), `dueAt` (optional ISO 8601)                                                                                                                                          |
| `complete_action_item` | Mark an action item as completed (idempotent).      | `id` (UUID)                                                                                                                                                                                                |
| `add_to_list`          | Add a contact to a list (idempotent).               | `listId` (UUID), `contactId` (UUID)                                                                                                                                                                        |

---

## 3. Resources

The server exposes read-only MCP resources formatted as JSON text:

- `contrack://pulse`: Current dashboard metrics, active counts, and overdue action items.
- `contrack://contacts/{id}`: Full contact dossier with relationship score explanation.

---

## 4. Prompts

Predefined prompt workflows help AI clients generate structured CRM reviews:

- `catch_me_up`: Prepares a briefing on a specific contact (`contactId`), inlining their profile details and the last 20 timeline interactions.
- `weekly_review`: Gathers overdue action items, items due this week, the tracked contacts and their bands, and the catch-ups past their cadence to produce a prioritized weekly CRM agenda.

---

## 5. Client Setup Guides

Generate a personal API token in **Settings → Account → API tokens** (`/settings/account#tokens`) before configuring your client.

### Claude Code

Run the following command in your terminal:

```bash
claude mcp add --transport http http://localhost:3210/api/mcp --header "Authorization: Bearer <YOUR_TOKEN>"
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "contrack": {
      "url": "http://localhost:3210/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

### Cursor

Add to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "contrack": {
      "url": "http://localhost:3210/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

### Direct HTTP / curl

```bash
curl -X POST http://localhost:3210/api/mcp \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```
