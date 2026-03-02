const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const { parsePrefix, resolveRoute, loadConfig, validateConfig } = require('../src/router');
const { resolveActiveRule, detectConflicts, validateSchedule } = require('../src/scheduler');
const { routeAndExecute } = require('../src/executor');
const { createLogger, rotateIfNeeded } = require('../src/logger');
const { pickModelFromStatus, ensureAuth } = require('../src/session-controller');

test('parsePrefix extracts prefix and body', () => {
  const result = parsePrefix('@mini hello world');
  assert.equal(result.prefix, '@mini');
  assert.equal(result.body, 'hello world');
});

test('parsePrefix strips trailing punctuation', () => {
  const result = parsePrefix('@mini: hello');
  assert.equal(result.prefix, '@mini');
  assert.equal(result.body, 'hello');
});

test('resolveRoute returns mapping for supported prefix', () => {
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const route = resolveRoute('@codex', config);
  assert.equal(route.model, 'openai-codex/gpt-5.3-codex');
});

test('resolveRoute supports alias prefixes', () => {
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const route = resolveRoute('@c', config);
  assert.equal(route.model, 'openai-codex/gpt-5.3-codex');
});

test('validateConfig rejects alias target that does not exist in prefixMap', () => {
  assert.throws(() => validateConfig({
    prefixMap: { '@mini': { model: 'minimax/MiniMax-M2.5' } },
    aliasMap: { '@m': '@missing' },
  }), /points to missing prefix/);
});

test('validateConfig rejects bad retry section', () => {
  assert.throws(() => validateConfig({
    prefixMap: { '@mini': { model: 'minimax/MiniMax-M2.5' } },
    retry: { maxRetries: -1 },
  }), /non-negative integer/);

  assert.throws(() => validateConfig({
    prefixMap: { '@mini': { model: 'minimax/MiniMax-M2.5' } },
    retry: { verifyRetries: -1 },
  }), /retry.verifyRetries/);

  assert.throws(() => validateConfig({
    prefixMap: { '@mini': { model: 'minimax/MiniMax-M2.5' } },
    retry: { verifyDelayMs: -1 },
  }), /retry.verifyDelayMs/);
});

test('loadConfig respects ROUTER_CONFIG_PATH', () => {
  const tmpPath = path.join(__dirname, 'tmp.router.config.json');
  const payload = {
    prefixMap: { '@x': { model: 'm1', fallbackModel: 'm2' } },
    retry: { maxRetries: 0, baseDelayMs: 0 },
  };
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  const prev = process.env.ROUTER_CONFIG_PATH;
  process.env.ROUTER_CONFIG_PATH = tmpPath;
  const cfg = loadConfig();
  assert.equal(cfg.prefixMap['@x'].model, 'm1');
  if (prev === undefined) delete process.env.ROUTER_CONFIG_PATH;
  else process.env.ROUTER_CONFIG_PATH = prev;
  try { fs.unlinkSync(tmpPath); } catch {}
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

test('createLogger writes jsonl records with ts/type', () => {
  const logPath = path.join(__dirname, 'tmp.logger.schema.jsonl');
  try { fs.unlinkSync(logPath); } catch {}

  const logger = createLogger(logPath);
  logger.log({ type: 'route.success', routeId: 'r1' });
  logger.log({ type: 'route.failure', code: 'X' });

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, 'route.success');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(lines[0].ts));
  assert.equal(lines[1].type, 'route.failure');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(lines[1].ts));

  try { fs.unlinkSync(logPath); } catch {}
});

test('rotateIfNeeded rotates oversized log file', () => {
  const logPath = path.join(__dirname, 'tmp.rotate.log');
  try { fs.unlinkSync(logPath); } catch {}
  try { fs.unlinkSync(`${logPath}.1`); } catch {}

  fs.writeFileSync(logPath, 'x'.repeat(64), 'utf8');
  rotateIfNeeded(logPath, 32, 2);

  assert.equal(fs.existsSync(logPath), false);
  assert.equal(fs.existsSync(`${logPath}.1`), true);

  try { fs.unlinkSync(`${logPath}.1`); } catch {}
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

test('routeAndExecute raises FALLBACK_EXECUTION_FAILED when fallback run also fails', async () => {
  let model = 'openai-codex/gpt-5.3-codex';
  let runs = 0;
  const events = [];
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));

  await assert.rejects(() => routeAndExecute({
    message: '@mini still broken',
    config,
    sessionController: {
      async getCurrentModel() { return model; },
      async setModel(next) { model = next; return true; },
    },
    taskExecutor: {
      async execute() {
        runs += 1;
        throw new Error(`run-${runs}`);
      },
    },
    logger: { log(event) { events.push(event); } },
  }), /Fallback execution failed/);

  assert.equal(events.at(-1).code, 'FALLBACK_EXECUTION_FAILED');
});

test('routeAndExecute attempts restore on fallback failure', async () => {
  let model = 'openai-codex/gpt-5.3-codex';
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));

  await assert.rejects(() => routeAndExecute({
    message: '@mini fail restore',
    config,
    sessionController: {
      async getCurrentModel() { return model; },
      async setModel(next) { model = next; return true; },
    },
    taskExecutor: {
      async execute() { throw new Error('always fail'); },
    },
    logger: { log() {} },
  }), /Fallback execution failed/);

  assert.equal(model, 'openai-codex/gpt-5.3-codex');
});

test('routeAndExecute skips restore when rollbackOnFailure is false', async () => {
  let model = 'openai-codex/gpt-5.3-codex';
  const base = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const config = {
    ...base,
    safety: {
      ...(base.safety || {}),
      rollbackOnFailure: false,
    },
  };

  await assert.rejects(() => routeAndExecute({
    message: '@mini fail without restore',
    config,
    sessionController: {
      async getCurrentModel() { return model; },
      async setModel(next) { model = next; return true; },
    },
    taskExecutor: {
      async execute() { throw new Error('always fail'); },
    },
    logger: { log() {} },
  }), /Fallback execution failed/);

  assert.equal(model, 'openai-codex/gpt-5.3-codex');
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

test('routeAndExecute reports already-on-model for prefix-only', async () => {
  let model = 'openai-codex/gpt-5.3-codex';
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const result = await routeAndExecute({
    message: '@codex',
    config,
    sessionController: {
      async getCurrentModel() { return model; },
      async setModel(next) { model = next; return true; },
    },
    taskExecutor: { async execute() { return 'ok'; } },
    logger: { log() {} },
  });
  assert.equal(result.alreadyOnModel, true);
  assert.equal(result.output, 'already_on:openai-codex/gpt-5.3-codex');
});


test('routeAndExecute passes through non-prefix input', async () => {
  const config = loadConfig(path.join(__dirname, '..', 'router.config.json'));
  const outputs = [];
  const result = await routeAndExecute({
    message: '   hello router  ',
    config,
    sessionController: {
      async getCurrentModel() { return 'minimax/MiniMax-M2.5'; },
      async setModel() { return true; },
    },
    taskExecutor: {
      async execute(input) { outputs.push(input); return 'ok'; },
    },
    logger: { log() {} },
  });

  assert.equal(result.switched, false);
  assert.deepEqual(outputs, ['   hello router  ']);
});

test('scheduler resolves active rule by time and priority', () => {
  const schedule = {
    rules: [
      { id: 'a', days: ['sat'], start: '09:00', end: '18:00', model: 'm1', priority: 1, enabled: true },
      { id: 'b', days: ['sat'], start: '09:00', end: '18:00', model: 'm2', priority: 5, enabled: true },
    ],
  };
  const at = new Date('2026-02-28T10:00:00');
  const rule = resolveActiveRule(schedule, at);
  assert.equal(rule.id, 'b');
});

test('scheduler detects overlapping conflicts with same priority', () => {
  const schedule = {
    rules: [
      { id: 'a', days: ['sat'], start: '09:00', end: '18:00', model: 'm1', priority: 1, enabled: true },
      { id: 'b', days: ['sat'], start: '12:00', end: '20:00', model: 'm2', priority: 1, enabled: true },
    ],
  };
  const conflicts = detectConflicts(schedule);
  assert.equal(conflicts.length, 1);
});

test('validateSchedule rejects duplicate rule ids', () => {
  assert.throws(() => validateSchedule({
    rules: [
      { id: 'dup', days: ['mon'], start: '09:00', end: '10:00', model: 'm1', priority: 1, enabled: true },
      { id: 'dup', days: ['tue'], start: '09:00', end: '10:00', model: 'm2', priority: 1, enabled: true },
    ],
  }), /duplicate rule id/);
});

test('scheduler detects overnight conflict with next-day early window', () => {
  const schedule = {
    rules: [
      { id: 'sat_night', days: ['sat'], start: '22:00', end: '06:00', model: 'night', priority: 2, enabled: true },
      { id: 'sun_early', days: ['sun'], start: '01:00', end: '03:00', model: 'early', priority: 2, enabled: true },
    ],
  };
  const conflicts = detectConflicts(schedule);
  assert.deepEqual(conflicts, [{ a: 'sat_night', b: 'sun_early' }]);
});

test('scheduler does not report overnight conflict when windows do not overlap', () => {
  const schedule = {
    rules: [
      { id: 'sat_night', days: ['sat'], start: '22:00', end: '01:00', model: 'night', priority: 2, enabled: true },
      { id: 'sun_morning', days: ['sun'], start: '02:00', end: '03:00', model: 'morning', priority: 2, enabled: true },
    ],
  };
  const conflicts = detectConflicts(schedule);
  assert.equal(conflicts.length, 0);
});

test('scheduler resolve respects configured timezone', () => {
  const schedule = {
    timezone: 'Europe/Rome',
    rules: [
      { id: 'rome_day', days: ['mon'], start: '09:00', end: '18:00', model: 'm1', priority: 1, enabled: true },
    ],
  };
  const atUtc = new Date('2026-03-02T08:30:00Z'); // 09:30 in Europe/Rome
  const rule = resolveActiveRule(schedule, atUtc);
  assert.equal(rule.id, 'rome_day');
});

test('scheduler overnight rule remains active after midnight using previous day', () => {
  const schedule = {
    timezone: 'UTC',
    rules: [
      { id: 'sat_night', days: ['sat'], start: '22:00', end: '06:00', model: 'm_night', priority: 1, enabled: true },
    ],
  };
  const at = new Date('2026-03-01T01:30:00Z'); // Sunday early morning, should still match Saturday overnight rule.
  const rule = resolveActiveRule(schedule, at);
  assert.equal(rule.id, 'sat_night');
});

test('scheduler overnight rule does not leak into following day evening', () => {
  const schedule = {
    timezone: 'UTC',
    rules: [
      { id: 'sat_night', days: ['sat'], start: '22:00', end: '06:00', model: 'm_night', priority: 1, enabled: true },
    ],
  };
  const at = new Date('2026-03-01T22:30:00Z'); // Sunday late evening should not match saturday-only rule.
  const rule = resolveActiveRule(schedule, at);
  assert.equal(rule, null);
});

test('pickModelFromStatus prefers activeModel over defaultModel', () => {
  const picked = pickModelFromStatus({ activeModel: 'm_active', defaultModel: 'm_default' });
  assert.equal(picked, 'm_active');
});

test('pickModelFromStatus supports nested models payload', () => {
  const picked = pickModelFromStatus({ models: { activeModel: 'm_nested' } });
  assert.equal(picked, 'm_nested');
});

test('pickModelFromStatus supports nested data payload and ignores empty strings', () => {
  const picked = pickModelFromStatus({ data: { activeModel: '   ', model: 'm_data' } });
  assert.equal(picked, 'm_data');
});

test('ensureAuth throws AUTH_MISSING when required env is absent', () => {
  const prev = process.env.ROUTER_TEST_TOKEN;
  delete process.env.ROUTER_TEST_TOKEN;
  try {
    assert.throws(() => ensureAuth({ requiredEnv: ['ROUTER_TEST_TOKEN'] }), /Missing auth env/);
  } finally {
    if (prev === undefined) delete process.env.ROUTER_TEST_TOKEN;
    else process.env.ROUTER_TEST_TOKEN = prev;
  }
});

test('ensureAuth passes when required env exists', () => {
  const prev = process.env.ROUTER_TEST_TOKEN;
  process.env.ROUTER_TEST_TOKEN = 'ok';
  try {
    ensureAuth({ requiredEnv: ['ROUTER_TEST_TOKEN'] });
  } finally {
    if (prev === undefined) delete process.env.ROUTER_TEST_TOKEN;
    else process.env.ROUTER_TEST_TOKEN = prev;
  }
});

test('cli schedule apply returns RULE_DISABLED for disabled rule id', () => {
  const schedulePath = path.join(__dirname, 'tmp.schedule.disabled.json');
  fs.writeFileSync(schedulePath, JSON.stringify({
    timezone: 'UTC',
    rules: [
      { id: 'disabled_rule', days: ['mon'], start: '00:00', end: '23:59', model: 'm_disabled', priority: 1, enabled: false },
    ],
  }, null, 2));

  try {
    assert.throws(() => execFileSync('node', [
      path.join(__dirname, '..', 'src', 'cli.js'),
      'schedule', 'apply',
      '--id', 'disabled_rule',
      '--schedule', schedulePath,
      '--config', path.join(__dirname, '..', 'router.config.json'),
      '--json',
    ], { encoding: 'utf8', stdio: 'pipe' }), (err) => {
      assert.equal(err.status, 4);
      const payload = JSON.parse(String(err.stdout || '{}'));
      assert.equal(payload.code, 'RULE_DISABLED');
      assert.equal(payload.ruleId, 'disabled_rule');
      return true;
    });
  } finally {
    try { fs.unlinkSync(schedulePath); } catch {}
  }
});
