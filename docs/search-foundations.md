# Search evidence in v2

Ask searches passages from complete biographies, preferences, employment records, and education records. The existing compact contact vector remains available.

The database keeps the original contact fields and history rows. Each derived passage stores its contact, source record, source hash, and exact UTF-16 offsets. Chunks contain at most 480 characters and overlap by 80 characters. Employment context distinguishes current, former, and unknown status. A missing end date alone does not establish current employment.

The passage index combines SQLite FTS5 and int8 vectors from the existing MiniLM model. Retrieval applies account, visibility, and query filters before ranking. It groups vector matches by contact. Verification reads up to two relevant passages per candidate. The local cross-encoder also reads relevant evidence before the fixed profile prefix.

The model returns an exact quote and a passage reference. The server checks the contact, source revision, and quote before it returns a verified match. `aiEvidence` exposes the checked reference for future citation and summary interfaces. A quote proves source presence. It does not independently prove that the source itself is correct.

The query compiler keeps activity descriptions separate from required industries. For example, "builds artificial hands" describes expertise. It does not require an industry field that contains those words.

## Index lifecycle

`search_passages` and `search_passage_state` are rebuildable data. Their Drizzle migration adds no new authoritative contact data. The generated snapshot also records existing tables that the guarded migrations in `server/db.ts` already create.

The index state identifies the embedding model, vector width, representation version, and build generation. A changed model or representation rebuilds the derived index. It preserves contacts, histories, and original import payloads.

The rebuild reads bounded pages and takes turns between accounts. A durable queue records unfinished work. A transaction publishes a contact vector, every passage vector, and the completion marker together. Interrupted work resumes from missing markers. Edits during embedding invalidate the pending result. A model change also prevents an old build from writing into the new index.

History edits invalidate the relevant contact's evidence. Moving a history row invalidates both contacts. Archive and restore operations update vector visibility. Deletes remove passage vectors through source-table triggers. Completed indexing advances the account's search revision, so earlier cached answers cannot hide newly indexed evidence.

The existing coverage endpoint counts complete contact and passage indexes. It also returns the representation version, embedding signature, and evidence count. Keyword search remains available while rebuilding.

## Data retention

Complete JSON exports include raw import payloads and history provenance. Normal contact responses still omit raw import payloads. SQLite backups retain the original fields, history, and derived index. CSV and vCard remain partial interchange formats.

## Quality checks

`tests/eval/passages.eval.test.ts` adds separate late-source questions to the existing search and answer gates. It replays real MiniLM vectors and Gemini responses through the database, retrieval, verification, and citation checks. CI requires no model download or API key. Recorded references bind to source IDs rather than candidate rank.

Run the live benchmark against synthetic data:

```sh
node scripts/benchmark-passages.ts --contacts 5000 --live --report /tmp/passage-results.json
```

Refresh the small CI recording with a configured provider:

```sh
node scripts/benchmark-passages.ts --contacts 100 --record --report /tmp/passage-recording.json
```

Both commands use a temporary database. The report separates retrieval recall, final precision and recall, fallback counts, indexing time, and query latency. The benchmark includes paraphrases and empty answers. It does not estimate accuracy across all personal networks.

### Measurements on September 28, 2026

The final local run used MiniLM embeddings and Gemini 3.5 Flash-Lite. The test contains 20 positive questions and four negative questions. Relevant facts appear after the old text limits. Most additional contacts contain short, repeated administrative descriptions.

| Measurement                                           | 5,000 contacts | 50,000 contacts |
| ----------------------------------------------------- | -------------- | --------------- |
| Complete index coverage                               | 100%           | 100%            |
| Indexing time, with the model already loaded          | 7.8 seconds    | 124.8 seconds   |
| Passage count                                         | 5,091          | 50,091          |
| Whole database size                                   | 15.9 MB        | 148.8 MB        |
| Local retrieval p95, with the query vector supplied   | 9.8 ms         | 97.4 ms         |
| Compact contact vector recall in the first 10 results | 40%            | 40%             |
| Passage hybrid recall in the first 10 results         | 95%            | 90%             |
| Final live answer precision / recall                  | 100% / 95%     | No live run     |
| Final live answer p95                                 | 3.2 seconds    | No live run     |

The live run found 19 expected contacts, returned no incorrect contacts, and returned empty answers for all four negative questions. It used no fallback answers. The clock-repair question missed its contact. Local retrieval placed that contact at rank 40, outside the 30-contact verification limit.

The existing 70-question benchmark at 5,000 contacts retained 100% recall in the first 10 results after local reranking. Its mean reciprocal rank was 0.9929. Conceptual search p95 was 37.8 ms. These measurements describe one machine and synthetic data. They do not establish production accuracy or compare the complete old and new answer pipelines.

## Remaining limits

Retrieval caps each passage channel at 300 passages. Verification still caps the candidate pool at 30. Very long sources or many relevant contacts can exceed these limits. Index size and rebuild work grow with source length.

The raw import payload remains an archive, not searchable text. Search uses normalized contact fields and history. V2.1 can add explicit employment conditions, adaptive candidate expansion, richer validated summaries, and a measured embedding-model upgrade. Concise TODOs identify the relevant code paths. These additions can reuse the source references and rebuild machinery without replacing user data.
