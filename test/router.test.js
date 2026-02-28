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

test('routeAndExecute logs failure for invalid prefix', async () => {
  const events = [];
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const logger = { log(event) { events.push(event); } };

  await assert.rejects(() => routeAndExecute({
    message: '@unknown hello',
    config,
    sessionController: {
      async getCurrentModel() { return 'minimax/MiniMax-M2.5'; },
      async setModel() { return true; },
    },
    taskExecutor: { async execute() { return 'ok'; } },
    logger,
  }), /Unsupported prefix/);

  assert.equal(events.at(-1).type, 'route.failure');
  assert.equal(events.at(-1).code, 'INVALID_PREFIX');
});

test('routeAndExecute throws when fallback switch cannot verify', async () => {
  let model = 'minimax/MiniMax-M2.5';
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));

  await assert.rejects(() => routeAndExecute({
    message: '@mini retry me',
    config,
    sessionController: {
      async getCurrentModel() { return model; },
      async setModel(next) {
        if (next === 'openai-codex/gpt-5.3-codex') {
          model = 'unexpected/model';
          return true;
        }
        model = next;
        return true;
      },
    },
    taskExecutor: {
      async execute() { throw new Error('first run fails'); },
    },
    logger: { log() {} },
  }), /Model verification failed/);
});

test('routeAndExecute retries transient setModel failure', async () => {
  let model = 'minimax/MiniMax-M2.5';
  let attempts = 0;
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));

  const result = await routeAndExecute({
    message: '@codex quick task',
    config,
    sessionController: {
      async getCurrentModel() { return model; },
      async setModel(next) {
        attempts += 1;
        if (attempts === 1) return false;
        model = next;
        return true;
      },
    },
    taskExecutor: {
      async execute(input) { return `ok:${input}`; },
    },
    logger: { log() {} },
  });

  assert.equal(result.output, 'ok:quick task');
  assert.ok(attempts >= 2);
});

test('routeAndExecute handles prefix-only message as switch confirmation', async () => {
  let model = 'minimax/MiniMax-M2.5';
  const calls = [];
  const events = [];
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));

  const result = await routeAndExecute({
    message: '@codex',
    config,
    sessionController: {
      async getCurrentModel() { return model; },
      async setModel(next) { model = next; return true; },
    },
    taskExecutor: {
      async execute(input) { calls.push(input); return `ok:${input}`; },
    },
    logger: { log(event) { events.push(event); } },
  });

  assert.equal(result.switchOnly, true);
  assert.equal(result.targetModel, 'openai-codex/gpt-5.3-codex');
  assert.deepEqual(calls, []);
  assert.equal(events.at(-1).type, 'route.switch_only');
});
