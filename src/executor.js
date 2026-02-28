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

async function switchAndVerify(sessionController, targetModel) {
  const switched = await sessionController.setModel(targetModel);
  if (!switched) {
    throw new ProviderUnavailableError(targetModel, { phase: 'setModel' });
  }

  const verified = await sessionController.getCurrentModel();
  if (verified !== targetModel) {
    throw new VerificationError(targetModel, verified);
  }
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

  let route;
  try {
    route = resolveRoute(prefix, config);
  } catch (err) {
    logger.log({
      type: 'route.failure',
      prefix,
      reason: err.message,
      code: err.code || 'ROUTE_RESOLVE_FAILED',
      latencyMs: Date.now() - startedAt,
    });
    throw err;
  }

  const targetModel = route.model;
  const fallbackModel = route.fallbackModel || null;

  const current = await sessionController.getCurrentModel();
  if (current !== targetModel) {
    try {
      await withRetry(async () => switchAndVerify(sessionController, targetModel), config.retry?.maxRetries ?? 1, config.retry?.baseDelayMs ?? 120);
    } catch (err) {
      logger.log({
        type: 'route.failure',
        prefix,
        targetModel,
        reason: err.message,
        code: err.code || 'MODEL_SWITCH_FAILED',
        latencyMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  const switched = current !== targetModel;
  if (!body) {
    logger.log({
      type: 'route.switch_only',
      prefix,
      targetModel,
      switched,
      latencyMs: Date.now() - startedAt,
    });
    return {
      switched,
      targetModel,
      switchOnly: true,
      output: `switched:${targetModel}`,
    };
  }

  try {
    const output = await taskExecutor.execute(body);
    logger.log({
      type: 'route.success',
      prefix,
      targetModel,
      fallbackModel,
      latencyMs: Date.now() - startedAt,
    });
    return { switched, targetModel, output };
  } catch (err) {
    if (fallbackModel) {
      await withRetry(async () => switchAndVerify(sessionController, fallbackModel), config.retry?.maxRetries ?? 1, config.retry?.baseDelayMs ?? 120);
      logger.log({
        type: 'route.fallback',
        prefix,
        targetModel,
        fallbackModel,
        reason: err.message,
        latencyMs: Date.now() - startedAt,
      });
      const output = await taskExecutor.execute(body);
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
