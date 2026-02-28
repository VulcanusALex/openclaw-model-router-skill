const { parsePrefix, resolveRoute } = require('./router');
const {
  RouterError,
  ProviderUnavailableError,
  VerificationError,
} = require('./errors');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(task, retries = 1, delayMs = 120) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (err) {
      lastErr = err;
      if (!err.retryable || attempt === retries) {
        throw err;
      }
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

async function routeAndExecute({
  message,
  config,
  sessionController,
  taskExecutor,
  logger,
}) {
  const startedAt = Date.now();
  const { prefix, body } = parsePrefix(message);

  if (!prefix) {
    const output = await taskExecutor.execute(message);
    logger.log({ type: 'route.skip', reason: 'no_prefix', latencyMs: Date.now() - startedAt });
    return { switched: false, output };
  }

  const route = resolveRoute(prefix, config);
  const targetModel = route.model;
  const fallbackModel = route.fallbackModel || null;

  const current = await sessionController.getCurrentModel();
  if (current !== targetModel) {
    await withRetry(async () => {
      const switched = await sessionController.setModel(targetModel);
      if (!switched) {
        throw new ProviderUnavailableError(targetModel, { phase: 'setModel' });
      }

      const verified = await sessionController.getCurrentModel();
      if (verified !== targetModel) {
        throw new VerificationError(targetModel, verified);
      }
    }, config.retry?.maxRetries ?? 1, config.retry?.baseDelayMs ?? 120);
  }

  try {
    const output = await taskExecutor.execute(body || message);
    logger.log({
      type: 'route.success',
      prefix,
      targetModel,
      fallbackModel,
      latencyMs: Date.now() - startedAt,
    });
    return { switched: current !== targetModel, targetModel, output };
  } catch (err) {
    if (fallbackModel) {
      await sessionController.setModel(fallbackModel);
      logger.log({
        type: 'route.fallback',
        prefix,
        targetModel,
        fallbackModel,
        reason: err.message,
        latencyMs: Date.now() - startedAt,
      });
      const output = await taskExecutor.execute(body || message);
      return { switched: true, targetModel: fallbackModel, output, fallback: true };
    }

    const wrapped = err instanceof RouterError
      ? err
      : new RouterError(`Execution failed: ${err.message}`, {
        code: 'EXECUTION_FAILED',
        retryable: false,
      });
    logger.log({
      type: 'route.failure',
      prefix,
      targetModel,
      reason: wrapped.message,
      code: wrapped.code,
      latencyMs: Date.now() - startedAt,
    });
    throw wrapped;
  }
}

module.exports = {
  routeAndExecute,
  withRetry,
};
