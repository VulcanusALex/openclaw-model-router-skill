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
