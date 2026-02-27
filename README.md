# OpenClaw Model Router Skill (Project Plan)

A high-reliability routing skill for OpenClaw that switches execution paths by user prefix, starting with:

- `@mini` → MiniMax M2.5
- `@codex` → Codex 5.3
- `@opus` → Claude Code CLI route (optional, non-session model)

## Why this project

Current prefix routing is useful but can be inconsistent if it relies on temporary behavior. This project aims to make routing deterministic, observable, and production-grade.

## Goals

1. **Deterministic routing**
   - Prefix always maps to one exact execution strategy.
2. **No gateway restart**
   - Switching should happen at session/task layer only.
3. **High reliability**
   - Idempotent switches, explicit success/failure confirmation, safe fallback.
4. **Operator visibility**
   - Log each route decision and outcome.
5. **Configurable policy**
   - Prefix/model mapping in config, not hardcoded.

## Scope (v1)

- Prefix parser (`@mini`, `@codex`)
- Session-level model override for supported providers
- Route execution pipeline:
  - parse → validate → switch → verify → execute
- Error handling:
  - provider unavailable
  - auth expired
  - rate-limit
- Structured route logs

## Scope (v1.5) — Generalized Time-based Model Scheduler

- Define arbitrary time rules: "what time -> which model"
- Store rules in local config (`router.schedule.json`)
- Compile/apply rules to OpenClaw cron jobs
- Provide management commands:
  - add rule
  - remove rule
  - enable/disable rule
  - list rules
  - validate conflicts
- Support precedence for overlapping rules
- Keep route audit log for every scheduled switch

## Scope (v1.1)

- Optional `@opus` adapter via Claude Code CLI (`claude -p`), with:
  - timeout controls
  - output normalization
  - long-task background mode

## Scope (v2)

- Policy DSL / YAML mapping (prefix, regex intent, model, fallback)
- Cost-aware routing (budget caps per day/session)
- Auto routing by task type (coding/research/chat) with manual override precedence

## Architecture

```text
User Message
   │
   ├─ Prefix Router
   │    ├─ @mini  -> Session Model Override: minimax/MiniMax-M2.5
   │    ├─ @codex -> Session Model Override: openai-codex/gpt-5.3-codex
   │    └─ @opus  -> CLI Adapter (optional)
   │
   ├─ Switch Verifier (read-back actual active model)
   ├─ Task Executor
   └─ Route Logger (event + latency + outcome)
```

## Reliability requirements

- **Idempotent**: repeat same prefix should not re-switch unnecessarily.
- **Atomic behavior**: do not execute task until switch is confirmed.
- **Clear failures**: explicit user-facing error with suggested fallback.
- **Safe defaults**: if route fails, keep current model unless user approves fallback.

## Milestones

### M1 (1-2 days)
- Project scaffold
- Prefix parser + `@mini/@codex`
- Session override + verification
- Basic tests

### M2 (2-4 days)
- Observability/logging
- Retry + fallback policy
- Robust error taxonomy

### M3 (optional)
- `@opus` CLI adapter
- Async/background long-task mode

### M4
- Packaging as reusable OpenClaw skill
- Documentation + examples

## Success metrics

- 99%+ correct routing on prefix-triggered messages
- Median routing overhead < 300ms (excluding model latency)
- Zero gateway restart required
- User-visible confirmation for every explicit model switch

## Risks

- Provider auth/token expiry
- Provider model-name drift
- CLI adapter behavior differences across OS

## Mitigations

- Startup health checks for all mapped routes
- Model alias table with validation
- Capability probe for CLI route before enabling

## Initial repo checklist

- [ ] Add implementation skeleton
- [ ] Add test harness for routing logic
- [ ] Add sample config (`router.config.json`)
- [ ] Add runbook (`docs/runbook.md`)
- [ ] Add changelog

---

Owner: @VulcanusALex
