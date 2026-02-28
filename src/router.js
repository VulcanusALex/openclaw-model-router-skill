const fs = require('node:fs');
const path = require('node:path');
const { InvalidPrefixError } = require('./errors');

function ensureNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
}

function validateConfig(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('router.config.json must be a JSON object');
  }

  if (!parsed.prefixMap || typeof parsed.prefixMap !== 'object' || Array.isArray(parsed.prefixMap)) {
    throw new Error('router.config.json missing prefixMap');
  }

  for (const [prefix, route] of Object.entries(parsed.prefixMap)) {
    if (!prefix.startsWith('@')) {
      throw new Error(`Invalid prefix key: ${prefix}. Prefix must start with @`);
    }
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new Error(`Invalid route config for ${prefix}`);
    }
    ensureNonEmptyString(route.model, `prefix ${prefix} missing model`);
    if (route.fallbackModel !== undefined) {
      ensureNonEmptyString(route.fallbackModel, `prefix ${prefix} fallbackModel must be non-empty string`);
    }
  }

  if (parsed.retry !== undefined) {
    if (!parsed.retry || typeof parsed.retry !== 'object' || Array.isArray(parsed.retry)) {
      throw new Error('retry must be an object');
    }
    if (parsed.retry.maxRetries !== undefined && (!Number.isInteger(parsed.retry.maxRetries) || parsed.retry.maxRetries < 0)) {
      throw new Error('retry.maxRetries must be a non-negative integer');
    }
    if (parsed.retry.baseDelayMs !== undefined && (!Number.isInteger(parsed.retry.baseDelayMs) || parsed.retry.baseDelayMs < 0)) {
      throw new Error('retry.baseDelayMs must be a non-negative integer');
    }
  }

  return parsed;
}

function loadConfig(configPath = path.join(process.cwd(), 'router.config.json')) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  return validateConfig(parsed);
}

function parsePrefix(input = '') {
  const trimmed = input.trim();
  if (!trimmed.startsWith('@')) {
    return { prefix: null, body: input };
  }

  const [head, ...rest] = trimmed.split(/\s+/);
  return {
    prefix: head.toLowerCase(),
    body: rest.join(' ').trim(),
  };
}

function resolveRoute(prefix, config) {
  if (!prefix) {
    return null;
  }
  const route = config.prefixMap[prefix];
  if (!route) {
    throw new InvalidPrefixError(prefix);
  }
  return route;
}

module.exports = {
  loadConfig,
  parsePrefix,
  resolveRoute,
  validateConfig,
};
