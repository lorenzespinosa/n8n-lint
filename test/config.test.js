import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, getDisabledRules, getSeverityOverrides } from '../src/config.js';

let workDir;
const originalCwd = process.cwd();

const writeConfig = (name, content) => {
  const filePath = join(workDir, name);
  writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
  return filePath;
};

// Capture console.error so warning branches can be asserted without noise.
const captureStderr = (fn) => {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
};

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-config-test-'));
});

after(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('should return defaults when the config file does not exist', () => {
    const config = loadConfig(join(workDir, 'missing.json'));
    assert.deepEqual(config, { rules: {}, fix: false });
  });

  it('should load and merge a valid config file', () => {
    const path = writeConfig('valid.json', {
      rules: { 'BP-01': 'off', 'SEC-03': 'error' },
      fix: true,
    });
    const config = loadConfig(path);
    assert.deepEqual(config.rules, { 'BP-01': 'off', 'SEC-03': 'error' });
    assert.equal(config.fix, true);
  });

  it('should warn and fall back to defaults on unparseable config files', () => {
    const path = writeConfig('broken.json', '{ not json');
    let config;
    const lines = captureStderr(() => {
      config = loadConfig(path);
    });
    assert.deepEqual(config, { rules: {}, fix: false });
    assert.ok(lines.some(l => l.includes('Failed to parse config file')));
  });

  it('should warn and drop rules when rules is not an object', () => {
    const path = writeConfig('rules-array.json', { rules: ['BP-01'], fix: true });
    let config;
    const lines = captureStderr(() => {
      config = loadConfig(path);
    });
    assert.deepEqual(config.rules, {});
    assert.equal(config.fix, true, 'unrelated keys should survive');
    assert.ok(lines.some(l => l.includes('"rules" in config must be an object')));
  });

  it('should treat a config without rules as empty rules', () => {
    const path = writeConfig('no-rules.json', { fix: false });
    const config = loadConfig(path);
    assert.deepEqual(config.rules, {});
    assert.equal(config.fix, false);
  });

  it('should discover .n8nlintrc.json in the working directory by default', () => {
    writeConfig('.n8nlintrc.json', { fix: true });
    process.chdir(workDir);
    try {
      const config = loadConfig();
      assert.equal(config.fix, true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('getDisabledRules', () => {
  it('should disable rules set to "off" or false', () => {
    const disabled = getDisabledRules({
      rules: { 'BP-01': 'off', 'SEC-02': false, 'SEC-03': 'warn', 'BP-05': 'error', 'BP-06': true },
    });
    assert.equal(disabled.size, 2);
    assert.ok(disabled.has('BP-01'));
    assert.ok(disabled.has('SEC-02'));
  });

  it('should return an empty set for missing or malformed rules', () => {
    assert.equal(getDisabledRules({}).size, 0);
    assert.equal(getDisabledRules({ rules: null }).size, 0);
    assert.equal(getDisabledRules({ rules: ['BP-01'] }).size, 0);
    assert.equal(getDisabledRules({ rules: 'nope' }).size, 0);
  });
});

describe('getSeverityOverrides', () => {
  it('should map warn and warning to warning, and error to error', () => {
    const overrides = getSeverityOverrides({
      rules: { 'SEC-03': 'warn', 'BP-01': 'warning', 'BP-05': 'error' },
    });
    assert.equal(overrides.size, 3);
    assert.equal(overrides.get('SEC-03'), 'warning');
    assert.equal(overrides.get('BP-01'), 'warning');
    assert.equal(overrides.get('BP-05'), 'error');
  });

  it('should ignore off, false and unknown settings', () => {
    const overrides = getSeverityOverrides({
      rules: { 'BP-01': 'off', 'SEC-02': false, 'BP-06': 'silent' },
    });
    assert.equal(overrides.size, 0);
  });

  it('should return an empty map for missing or malformed rules', () => {
    assert.equal(getSeverityOverrides({}).size, 0);
    assert.equal(getSeverityOverrides({ rules: null }).size, 0);
    assert.equal(getSeverityOverrides({ rules: ['SEC-03'] }).size, 0);
  });
});
