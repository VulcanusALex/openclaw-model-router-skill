const fs = require('node:fs');
const path = require('node:path');
const { InvalidPrefixError } = require('./errors');

function loadConfig(configPath = path.join(process.cwd(), 'router.config.json')) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.prefixMap || typeof parsed.prefixMap !== 'object') {
    throw new Error('router.config.json missing prefixMap');
  }
  return parsed;
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
};
