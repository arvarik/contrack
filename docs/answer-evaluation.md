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

## Evidence-backed query constraints

The planner supplies source phrases for hard filters. A deterministic compiler checks the query and rejects invented filters. It removes unsupported dates and keeps location words out of unrelated fields.

Structured locations require each city, region, and country component together. Alternative places remain alternatives. This separates London from Cambridge, Washington State from Washington, D.C., and New York City from other New York cities.

Reviewed role aliases include Research Fellow, Venture Scout, and senior technical leadership titles. The current role takes precedence over an old headline. The compiler rejects generic people words and industry-only terms as job titles. It preserves specific employer names. Paired tests check valid contacts and similar contacts that must not match.

The compiler uses a local place dictionary and literal fallback. It does not resolve every place name. It prevents negative phrases from becoming positive filters, but it does not implement a complete negative-query language.

These changes add no production model calls. A local microbenchmark over 1,000 contact locations measured median matching times near 6.3 ms. This measures local matching only, not provider latency.

## Label audit and live recording

The label audit added six valid expected matches across the bouldering, California, and London queries. It also added missing filter expectations and documented allowed optional traits. Scoring version 3 distinguishes required categories from allowed optional categories.

The previous result F1 was 0.8276. Applying corrected labels to the same returned contacts gives 0.9375. This increase comes from label corrections, not better retrieval.

Use a pinned model and query pacing when a provider has a low request quota:

```sh
AI_QUICK_MODEL=gemini:gemini-3.5-flash-lite npm run eval:record:answer -- --query-delay-ms 13000 --report /tmp/contrack-answer-report.json
```

The report includes per-query results and actual model identifiers. Pacing occurs outside the production search deadline. A failed capture cannot replace committed fixtures.

The historical recording used an unspecified default model. A fresh recording therefore compares both changed code and changed model responses. The small, reviewed corpus does not establish accuracy on unseen queries.

### Latest measured result

The September 15, 2026 UTC capture used `gemini-3.5-flash-lite` with scoring version 3.

| Measurement                                      | Result F1 | Correct matches | False positives | Misses |
| ------------------------------------------------ | --------: | --------------: | --------------: | -----: |
| Previous labels and historical answers           |    0.8276 |              24 |               7 |      3 |
| Corrected labels and the same historical answers |    0.9375 |              30 |               1 |      3 |
| Updated pipeline and fresh model answers         |    0.9846 |              32 |               0 |      1 |

The final capture has result precision 1.0000, result recall 0.9697, and filter F1 0.9925. All five empty-answer cases and four declared adversarial cases pass. The synthesis text checker reports 0.9820 and flags two assertions.

The remaining miss is the Staff Software Engineer in the fintech leadership query. Retrieval includes this contact, but the model omits it during reranking. An earlier live run included the contact. The fixture preserves the final run rather than selecting the best answer from several runs.

Further accuracy work needs repeated runs and unseen queries. A deterministic acceptance path for fully verified structured queries needs separate evaluation before it replaces model reranking.
