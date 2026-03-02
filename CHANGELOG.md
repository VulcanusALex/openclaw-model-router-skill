# Changelog

## 2026-03-02

- Fixed scheduler conflict detection for overnight windows that overlap next-day early rules.
- Added regression tests for overnight overlap/non-overlap conflict detection.
- `schedule apply --id <rule>` now rejects disabled rules with `RULE_DISABLED`.
- Added CLI regression test for disabled-rule apply behavior.
- Improved `test/soak.sh` to emit per-run logs and first-failure log path for faster triage.

## 2026-03-01

- Executor now respects `safety.rollbackOnFailure=false` when fallback execution also fails.
- Hardened `pickModelFromStatus` to parse nested `models` / `data` payload shapes.
- Extended retry config validation for `verifyRetries` and `verifyDelayMs`.
- Expanded tests for rollback toggle and status payload compatibility.
- Fixed overnight scheduler day-boundary behavior (post-midnight window now maps to previous configured day).
- Added alias target integrity validation (`aliasMap` must point to existing `prefixMap` keys).
- Added soak helper script `test/soak.sh` for repeated regression runs.

## 2026-02-28

- Scaffolded v1 router core (`parse -> validate -> switch -> verify -> execute`)
- Added retry + fallback behavior
- Added JSONL route logging
- Added sample `router.config.json`
- Added Node test coverage for parser, switch, success and fallback paths
- Added operator runbook
- Added strict config validation (`validateConfig`) to fail fast on malformed `prefixMap`/`retry`.
- Added explicit `FALLBACK_EXECUTION_FAILED` wrapping + failure log when fallback execution also fails.
- Expanded tests for config validation and fallback failure behavior.
