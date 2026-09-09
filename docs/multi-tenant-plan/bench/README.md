# bench/

Evidence produced while executing the plan. Expected files, by phase:

- `baseline-phase-0.md`: Phase 0 benchmark at `1 × 5000` and `10 × 2000`, including today's per-update FTS trigger cost.
- `tenant-lint-baseline.txt`: Phase 0 lint report.
- `rollback-rehearsal.md`: Phase 1.
- `phase-2.md`: benchmark after scoping.
- `ui-walkthrough.md` and screenshots: Phase 4.
- `phase-5.md`, `security-review.md`, `upgrade-rehearsal.md`: Phase 5.

Already present:

- `review-2026-09-08/`: the scripts and measurements from the plan review
  against `v1.5.5`. They back the answers in
  [14-risks-and-open-questions.md](../14-risks-and-open-questions.md) and the
  `cidTok` change in the data model document.
