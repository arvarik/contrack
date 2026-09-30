# MCP and API tokens

Contrack has an MCP server, so an AI assistant such as Claude or Cursor can
use your CRM. This page covers personal API tokens, how to connect a client,
and the tools, resources, and prompts the server offers.

![Settings, MCP and API: the endpoint URL, the token field, the client snippets, and the tools table](images/mcp.png)

## What MCP gives an assistant

MCP, the Model Context Protocol, is an open standard for connecting AI
assistants to other apps. With Contrack connected, an assistant can search
your contacts, read a timeline, log a note, and add a follow-up while you
talk to it. It works as your account and sees only your data.

**Settings → MCP and API** has everything a client needs:

- **MCP endpoint URL**, the one address every client uses. It is your
  Contrack's address with `/api/mcp` after it, such as
  `http://localhost:3210/api/mcp`.
- **Personal API token**, a field where you paste a token. The token stays on
  the page. It is never saved or sent, only put into the snippets.
- Snippets to copy for Claude Code, Claude Desktop and Cursor, and curl.
- **Tools**, the table of every tool a client can call.

The server speaks MCP over streamable HTTP. Each request stands alone, with no
session to keep open.

## Create a token

A client needs a personal API token when your Contrack asks people to sign
in.

1. Open **Settings → Account** and go to **API tokens**. The **MCP and API**
   page links there too, with **Create a token in Account**.
2. Select **Create token**.
3. In **What is it for**, name the machine or the script, such as "Claude
   Desktop on the laptop".
4. Choose when it expires: **30 days**, **90 days**, **1 year**, or **Never**.
   The default is 90 days.
5. Select **Create token**, and copy the token. It starts with `ctk_`.
   Contrack shows it only once. Then select **I've copied it**.

The **API tokens** list shows each token's name, its state, and its first
characters. The state is active, revoked, or expired. The list also shows
when each token was last used and when it expires.

To revoke a token, select **Revoke** on its row, then **Revoke token**. It
stops working at once. The row stays, marked revoked, so you can see later why
a script stopped.

- You create tokens while signed in. A token cannot create another token.
- An account with a temporary password must choose its own password first.
- An account can create 10 tokens an hour.

When your Contrack does not ask anyone to sign in, a client connects without a
token, and **Settings → Account** is not shown. See
[Accounts and sign-in](accounts.md#turn-on-sign-in).

## Connect a client

Copy the snippet for your client from **Settings → MCP and API**. Paste your
token into **Personal API token** first, and the snippets fill it in. The
examples below use `http://localhost:3210`. Use your own address instead.
When your Contrack does not ask anyone to sign in, leave out the
`Authorization` header.

### Claude Code

Run this in a terminal:

```bash
claude mcp add --transport http contrack http://localhost:3210/api/mcp --header "Authorization: Bearer <your-token>"
```

`contrack` is the name the server gets in Claude Code.

### Claude Desktop and Cursor

Add this to the `mcpServers` part of the client's config file:

```json
{
  "mcpServers": {
    "contrack": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:3210/api/mcp",
        "--header",
        "Authorization: Bearer <your-token>"
      ]
    }
  }
}
```

The config runs the `mcp-remote` bridge with `npx`, so the machine needs
Node.js. Claude Desktop keeps its config in `claude_desktop_config.json`.
Cursor reads `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for every
project. Restart the client after you change the file.

### Other clients

A client that speaks MCP over streamable HTTP can use the endpoint URL
directly. Send the token in the header `Authorization: Bearer <your-token>`.
A client that can only start a local command can use the `mcp-remote` bridge
above.

### Check the endpoint with curl

```bash
curl -X POST http://localhost:3210/api/mcp \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

A working endpoint answers with the server's details, which include
`"name":"contrack"`. The endpoint takes `POST` only.

## Tools

The server offers 15 tools. A read-only tool changes nothing.

| Tool                   | What it does                                                                                                        | Access         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------- |
| `search_people`        | Searches contacts with a question in plain words, with filters for role, company, location, industry, tag, and list | Read-only      |
| `get_contact`          | Returns one contact's full profile, with the score explanation when the contact is tracked                          | Read-only      |
| `list_contacts`        | Pages through contacts, with filters for role, company, industry, last update, and tracked                          | Read-only      |
| `get_timeline`         | Returns a contact's interactions and timeline                                                                       | Read-only      |
| `search_notes`         | Searches notes and interactions by words, date range, and type                                                      | Read-only      |
| `list_action_items`    | Lists open follow-ups: overdue, today, this week, or all                                                            | Read-only      |
| `get_pulse`            | Returns the Pulse figures: tracked contacts and their bands, catch-ups past their cadence, and follow-ups due       | Read-only      |
| `list_tags`            | Lists the tags used in your network                                                                                 | Read-only      |
| `list_lists`           | Lists your lists and how many contacts each holds                                                                   | Read-only      |
| `create_contact`       | Creates a contact with profile and contact details                                                                  | Read and write |
| `update_contact`       | Changes a contact's fields, including whether it is tracked and its cadence                                         | Read and write |
| `log_interaction`      | Logs a meeting, call, email, or note. With AI on, it also finds the people the text mentions                        | Read and write |
| `create_action_item`   | Adds a follow-up with a due date to a contact                                                                       | Read and write |
| `complete_action_item` | Marks a follow-up as done                                                                                           | Read and write |
| `add_to_list`          | Adds one or more contacts to a list                                                                                 | Read and write |

`search_people` and `search_notes` return up to 50 results. `list_contacts`
and `get_timeline` return up to 100 entries at a time.

With AI off for your account or for the instance, `search_people` answers from
the local index, as Ask Contrack does. **Enrich new contacts automatically**
does not research a contact that `create_contact` adds.

## Resources and prompts

The server also offers two resources, each as JSON:

- `contrack://pulse`: the Pulse data, with network figures, contacts at risk,
  and follow-ups.
- `contrack://contacts/{id}`: one contact's full profile and score
  explanation.

And two prompts, which a client can offer you as commands:

- `catch_me_up`: a briefing on one contact. It takes the contact's ID and
  includes the profile and the latest 20 timeline entries.
- `weekly_review`: a weekly review of overdue follow-ups, follow-ups due this
  week, and the tracked contacts to catch up with.

## Limits and errors

- Each account can send 120 requests a minute. Past that, the server answers
  `429` with a `Retry-After` header that says how many seconds to wait.
- A request with no valid token, on a Contrack that asks people to sign in,
  gets `401`.
- A tool that fails returns an MCP error. Its data holds Contrack's error
  code and HTTP status, such as `NOT_FOUND` for a contact that is not in your
  account.

## Keep your tokens safe

- A token acts as your account. Anyone who holds it can read and change your
  contacts, notes, and follow-ups.
- A token has your role. An admin's token can also use the administration
  API.
- A token cannot change your password, create tokens, or manage passkeys and
  devices. Those need you signed in.
- Give each client its own token. Then you can revoke one without the others.
- Revoke a token you no longer use, or one you think someone else has seen.
- A password reset stops every token of the account. Changing your own
  password in **Settings → Account** does not.
- Disabling an account stops its tokens until an admin enables it again.

> **Note:** The `API_TOKEN` environment variable is an older,
> instance-wide token. It acts as the first administrator for anyone who
> holds it, and it goes away in 3.0. Create a personal token, point your
> scripts at it, and remove the variable. **API tokens** shows a warning while
> the variable is set.

The same tokens work for the REST API, see the
[REST API reference](api-reference.md#authentication).

## Related

- [Accounts and sign-in](accounts.md)
- [REST API reference](api-reference.md)
- [Search and Ask Contrack](search.md)
- [Pulse and tracking](pulse.md)
