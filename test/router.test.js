const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { parsePrefix, resolveRoute, loadConfig } = require('../src/router');
const { routeAndExecute } = require('../src/executor');
const { createLogger } = require('../src/logger');

test('parsePrefix extracts prefix and body', () => {
  const result = parsePrefix('@mini hello world');
  assert.equal(result.prefix, '@mini');
  assert.equal(result.body, 'hello world');
});

test('resolveRoute returns mapping for supported prefix', () => {
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const route = resolveRoute('@codex', config);
  assert.equal(route.model, 'openai-codex/gpt-5.3-codex');
});

test('routeAndExecute switches model then runs body', async () => {
  const logPath = path.join(__dirname, 'tmp.log.jsonl');
  try { fs.unlinkSync(logPath); } catch {}

  let model = 'minimax/MiniMax-M2.5';
  const calls = [];
  const sessionController = {
    async getCurrentModel() { return model; },
    async setModel(next) { model = next; return true; },
  };
  const taskExecutor = {
    async execute(input) { calls.push(input); return `ok:${input}`; },
  };

  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const logger = createLogger(logPath);
  const result = await routeAndExecute({
    message: '@codex build parser',
    config,
    sessionController,
    taskExecutor,
    logger,
  });

  assert.equal(result.targetModel, 'openai-codex/gpt-5.3-codex');
  assert.deepEqual(calls, ['build parser']);
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.ok(lines.at(-1).includes('route.success'));
});

test('routeAndExecute falls back when executor throws', async () => {
  let model = 'openai-codex/gpt-5.3-codex';
  let runs = 0;
  const sessionController = {
    async getCurrentModel() { return model; },
    async setModel(next) { model = next; return true; },
  };
  const taskExecutor = {
    async execute() {
      runs += 1;
      if (runs === 1) throw new Error('boom');
      return 'recovered';
    },
  };

  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const logger = { log() {} };

  const result = await routeAndExecute({
    message: '@mini hi',
    config,
    sessionController,
    taskExecutor,
    logger,
  });

  assert.equal(result.fallback, true);
  assert.equal(result.output, 'recovered');
});
