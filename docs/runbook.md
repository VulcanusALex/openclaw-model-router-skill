# Model Router Runbook

## Validate configuration

```bash
node -e "console.log(require('./router.config.json'))"
```

## Run tests

```bash
node --test
```

## Integration contract

`routeAndExecute(...)` requires:

- `sessionController.getCurrentModel()`
- `sessionController.setModel(model)`
- `taskExecutor.execute(text)`
- `logger.log(event)`

## Operational notes

- Prefix-based routing is deterministic and idempotent.
- Switching is verified before task execution.
- Route events are JSONL and can be tailed for observability.

## New failure surfaces (2026-02-28 sprint)

- `FALLBACK_EXECUTION_FAILED`: primary execution failed, router switched to fallback model, but fallback execution still failed.
  - Action: inspect upstream tool/service health and payload validity.
- Config validation now fails fast at load time for malformed `prefixMap`/`retry` fields.
  - Action: fix `router.config.json` shape before runtime.
