# AI answer evaluation

The answer evaluation checks query planning, retrieval, reranking, and summary generation with a fixed contact corpus.

## Run the checks

1. Run `npm run test:eval` for the recorded regression tests. These tests use SQLite, FTS, vector search, and production answer functions.
2. Run `npm run eval:answer:live` for a fresh evaluation with a configured provider. This command does not update committed fixtures.
3. Run `npm run eval:record:answer` to capture fresh responses and replace the baseline. Review the resulting fixture and score changes before committing them.

Live runs require a configured provider and can incur provider charges. Both commands use a temporary database and remove it after the run.

Recording does not reuse previous responses. Provider failures, empty provider responses, and cancelled calls prevent successful recording. The gateway caps each generation at 90 seconds.

## What the scores mean

- Filter precision and recall measure expected filter categories. They also penalize unexpected categories. They do not verify every synonym in a category.
- Result precision and recall measure contact identities. Duplicate results and unexpected results count as false positives.
- The exploratory query has no fixed result set. Its explicit `evaluateResults: false` flag excludes it from aggregate result scores.
- Empty-answer accuracy requires zero matches and an explicit empty answer.
- Injection resistance checks forbidden matches and known output patterns for the declared attack cases.
- Synthesis scoring checks names, entity phrases, required entities, forbidden entities, and contact counts. Missing summaries and failed summaries reduce the score.

The synthesis score uses text rules. It does not prove every relationship or statement in a summary. Human review must assess factual claims that these rules cannot check.

## Replay limits

Replay returns historical model responses. It exercises current application code, but it does not ask a model to follow changed prompts.

A prompt change requires fresh live evaluation before anyone claims improved model accuracy. A passing replay test only confirms the recorded regression cases.

The corpus contains 39 contacts and 24 queries. Five contacts contain attack text. Four queries declare adversarial targets. The tag-breakout contact has no dedicated target query. These cases do not establish general injection resistance.

The exfiltration case also rejects output that names other corpus contacts. This check does not detect every possible data leak.

Replay stores each exact embedding input, including trait expansions. Missing embedding inputs fail the test instead of silently disabling vector retrieval.

Fixture checks reject missing responses, invalid vector dimensions, truncated vectors, non-finite vector values, duplicate identifiers, and conflicting expectations. Corpus checks also detect differences between source data and committed fixtures.

The baseline records the scoring version and measurement origin. A replay recalculation retains the original response capture date. Score changes from corrected rules do not represent a new model evaluation.

## Review changes

The PR review corrected these defects:

- The first summary response returned raw output, while later cache hits returned sanitized output.
- The summary prompt treated cached query filters as proof about the submitted contacts.
- Timeout overrides accepted invalid values and bypassed the maximum duration.
- Result scoring ignored unexpected contacts when the expected set was empty.
- Duplicate contacts inflated recall. Partial filter matches could count as complete matches.
- Missing summaries and some unsupported entity phrases received successful scores.
- Replay returned default responses when recordings were missing.
- Nine queries lacked expanded embedding vectors. Replay silently skipped vector retrieval for those inputs.
- Recording reused stale completions and could overwrite the baseline after provider failures.

The review keeps provider retries within the existing adapters. It adds no extra production model calls. Vector validation runs once when fixtures load.

## Research basis

[OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices) recommends task-specific tests, representative edge cases, continuous evaluation, and human calibration of automatic graders.

[Anthropic injection guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks) recommends separating third-party data from instructions, output screening, and adversarial workflow tests.

[Anthropic prompt injection research](https://www.anthropic.com/news/prompt-injection-defenses) describes remaining limitations and the importance of adaptive attack testing.
