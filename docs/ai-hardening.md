# AI reliability and cost controls

AI requests have bounded concurrency, deadlines, and output sizes. Contact
enrichment validates each result before a database write. The UI reports
failures and preserves access to active batch progress.

## Request limits

| Control             | Behavior                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generation queue    | Two active calls and 16 waiting calls per server. Overflow returns `429 AI_BUSY`.                                                                                           |
| Generation deadline | 60 seconds by default, capped at 150 seconds. Queue time and retries consume this deadline.                                                                                 |
| Output limit        | 4,096 tokens by default. Individual features set smaller limits where appropriate.                                                                                          |
| Transient failures  | At most one application retry. Native SDK automatic retries are disabled.                                                                                                   |
| Invalid output      | JSON and schema failures do not trigger another generation.                                                                                                                 |
| Enrichment          | One workflow per contact. The two-pass strategy makes one search call, two at Deep, and one extraction call. When no first search cites a page, two more are asked at once. |
| Batch size          | 1 to 100 unique active contacts. A start while the account's own batch runs joins that batch.                                                                               |

Cancellation removes queued work and stops later steps. The SDK receives the
abort signal for active work. Cancellation cannot reverse provider charges
for a request that the provider already accepted.

The OpenAI-compatible adapter can negotiate an unsupported JSON format after
an explicit provider rejection. It uses the same total deadline.

Gemini usage entries use unique IDs. Out-of-order responses update their own
entry. Explicit model pins are counted like routed calls. Unknown failures keep
the estimated usage because the provider can still charge for them. Daily
counts reset at midnight Pacific, including daylight saving time. A late
rejection cannot reduce the next day's grounding count. The counts are for the
Health page: nothing is refused because of them. A 429 pauses the model for
the delay Google names, and the retry goes to the next model.

## Contact data and caches

- Enrichment rejects overlapping requests for the same contact before another
  workflow starts.
- A local snapshot check rejects results after edits, deletion, archival, or
  merging. A transaction applies only validated, additive changes.
- Schema limits cap strings and arrays. Email and URL fields require valid
  values. Duplicate incoming child records do not create duplicate rows.
- Existing interests, attributes, and other user values remain intact.
- Briefing cache keys include contact facts, recent interaction content, and
  model choice. Identical active requests share one generation.
- Briefings and daily insights recheck their input before they save or cache
  a result. Settings changes clear AI caches.
- Deleted, merged, and archived contacts do not enter active research.
  Mention extraction cannot create contacts after the source note disappears.
- Missing AI configuration returns an actionable error. It does not return
  demonstration summaries as real results.

Enrichment records the pages the provider cited in the contact's research
record (`aiResearch`). The server resolves Gemini's redirect links to the real
addresses with a `HEAD` request and does not read the pages. The Research card
renders safe external links and ignores raw HTML and images. Source links help
users review research. They do not prove every extracted claim.

The two-pass strategy requires source links from the provider. A search pass
that cites no pages is asked twice more, at once, in two other forms. If no
ask cites a page, the prompt's own reply for that case records "no public
information" and changes no field. Any other answer returns
`502 AI_GROUNDING_MISSING` before extraction. If no ask returns any text, the
server returns `502 AI_NO_ANSWER`. Neither error saves a contact change.

## Progress and recovery

The batch API and frontend share a runtime schema. The frontend validates both
stream events and polling responses. It ignores responses for a different
batch. A successful job refreshes contact data once, which avoids repeated
list resets during polling.

The progress overlay supports a short viewport, scrolling, visible errors,
minimization, and cancellation. Polling continues after transient failures.
Missing batches stop polling and show a restart message.

Batch progress remains in memory. A server restart loses unfinished work and
progress history. The database retains completed contact updates. Persistent
batch state remains a separate follow-up.

## Local resources and dependencies

Local embedding inference uses two CPU threads and one inter-operation thread.
`DISABLE_BACKGROUND_JOBS=true` skips startup model loading, backfills, and
scheduled work for isolated test instances.

The dependency update removes the vulnerable DiceBear initials package and
uses the existing escaped monogram renderer. Both uploads and embeddings use
Sharp 0.35.4 or newer. The ONNX installer uses adm-zip 0.6.0 or newer, which
fixes the older allocation issue.

The production audit still reports three moderate entries for one unresolved
adm-zip symlink advisory and its dependency parents. ONNX imports adm-zip in
its package installation script. Do not treat a clean application build as
evidence that this upstream advisory is resolved.

## Verification

Regression tests use mocked providers. They cover queue overflow, cancellation,
retry limits, quota ordering, edits during research, invalid output, cache
freshness, missing batches, and frontend stream recovery.

Live checks use an isolated database and a small model. Run only the relevant
provider contract when an adapter changes. Full contract suites can make paid
calls across all configured providers.

Primary references:

- [Gemini cancellation configuration](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html)
- [Gemini HTTP retry configuration](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html)
- [OpenAI SDK retry configuration](https://github.com/openai/openai-node)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini rate limit resets](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)
- [adm-zip unresolved symlink advisory](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)
