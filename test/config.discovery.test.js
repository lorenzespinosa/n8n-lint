import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverConfigPath,
  loadConfigFile,
  loadConfig,
  ConfigError,
} from '../src/config.js';

let root;
const originalCwd = process.cwd();

before(() => {
  root = mkdtempSync(join(tmpdir(), 'n8n-lint-discovery-'));
});

after(() => {
  process.chdir(originalCwd);
  rmSync(root, { recursive: true, force: true });
});

const writeConfigAt = (dir, content) => {
  const filePath = join(dir, '.n8nlintrc.json');
  writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
  return filePath;
};

describe('discoverConfigPath', () => {
  it('finds the config in the start directory', () => {
    const project = join(root, 'here');
    mkdirSync(project);
    const filePath = writeConfigAt(project, { fix: true });
    assert.equal(discoverConfigPath(project, root), filePath);
  });

  it('finds the config in a parent directory', () => {
    const project = join(root, 'project');
    const deep = join(project, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    const filePath = writeConfigAt(project, { fix: true });
    assert.equal(discoverConfigPath(deep, root), filePath);
  });

  it('prefers the nearest config over a farther one', () => {
    const project = join(root, 'nearest');
    const nested = join(project, 'nested');
    mkdirSync(nested, { recursive: true });
    writeConfigAt(project, { fix: true });
    const nestedPath = writeConfigAt(nested, { fix: false });
    assert.equal(discoverConfigPath(nested, root), nestedPath);
  });

  it('returns null when no config exists up to the stop directory', () => {
    const empty = join(root, 'empty-chain', 'deep');
    mkdirSync(empty, { recursive: true });
    assert.equal(discoverConfigPath(empty, root), null);
  });

  it('does not look above the stop directory', () => {
    const only = join(root, 'bounded');
    mkdirSync(only);
    writeConfigAt(root, { fix: true });
    assert.equal(discoverConfigPath(only, only), null);
  });

  it('discovers from the cwd by default', () => {
    const project = join(root, 'from-cwd');
    const deep = join(project, 'deep');
    mkdirSync(deep, { recursive: true });
    const filePath = writeConfigAt(project, { fix: true });
    process.chdir(deep);
    try {
      // process.cwd() is always symlink-resolved (e.g. macOS /private/var), while
      // filePath may be in the unresolved spelling; compare canonical paths
      assert.equal(realpathSync(discoverConfigPath(undefined, root)), realpathSync(filePath));
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('loadConfigFile (strict)', () => {
  it('normalizes a complete config file', () => {
    const dir = join(root, 'strict-full');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({
      rules: { 'BP-01': 'off', 'SEC-03': 'error', 'BP-05': 'warn' },
      profiles: ['strict'],
      fix: true,
    }));
    assert.deepEqual(loadConfigFile(filePath), {
      rules: { 'BP-01': 'off', 'SEC-03': 'error', 'BP-05': 'warn' },
      profiles: ['strict'],
      fix: true,
    });
  });

  it('defaults optional keys', () => {
    const dir = join(root, 'strict-empty');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, '{}');
    assert.deepEqual(loadConfigFile(filePath), { rules: {}, profiles: [], fix: false });
  });

  it('throws for a missing file', () => {
    assert.throws(
      () => loadConfigFile(join(root, 'nope.json')),
      err => err instanceof ConfigError && err.kind === 'missing' && /Config file not found/.test(err.message)
    );
  });

  it('throws for invalid JSON', () => {
    const dir = join(root, 'strict-broken');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, '{ not json');
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'parse' && /Invalid JSON/.test(err.message)
    );
  });

  it('throws for a non-object root', () => {
    const dir = join(root, 'strict-array-root');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, '["BP-01"]');
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'parse' && /must contain a JSON object/.test(err.message)
    );
  });

  it('throws for unknown top-level keys', () => {
    const dir = join(root, 'strict-unknown-key');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ rulez: {} }));
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'unknown-key' &&
        /"rulez"/.test(err.message) && /rules, profiles, fix/.test(err.message)
    );
  });

  it('throws for non-object rules', () => {
    const dir = join(root, 'strict-rules-type');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ rules: ['BP-01'] }));
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'rules-type' && /"rules" must be an object/.test(err.message)
    );
  });

  it('throws for unknown rule ids', () => {
    const dir = join(root, 'strict-unknown-rule');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ rules: { 'XX-99': 'off' } }));
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'unknown-rule' &&
        /Unknown rule id "XX-99"/.test(err.message) && /BP-07/.test(err.message)
    );
  });

  it('throws for bad severity values', () => {
    const dir = join(root, 'strict-bad-severity');
    mkdirSync(dir);
    for (const bad of ['warning', false, 'silent', 2, null]) {
      const filePath = join(dir, `rc-${String(bad)}.json`);
      writeFileSync(filePath, JSON.stringify({ rules: { 'BP-01': bad } }));
      assert.throws(
        () => loadConfigFile(filePath),
        err => err instanceof ConfigError && err.kind === 'severity' &&
          /Invalid severity/.test(err.message) && /off, warn, error/.test(err.message),
        `severity ${JSON.stringify(bad)} should be rejected`
      );
    }
  });

  it('rejects configuring SCHEMA-01', () => {
    const dir = join(root, 'strict-schema01');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ rules: { 'SCHEMA-01': 'off' } }));
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'schema-01' && /SCHEMA-01/.test(err.message)
    );
  });

  it('throws for non-array profiles', () => {
    const dir = join(root, 'strict-profiles-type');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ profiles: 'strict' }));
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'profiles-type' && /"profiles" must be an array/.test(err.message)
    );
  });

  it('throws for unknown profile names', () => {
    const dir = join(root, 'strict-unknown-profile');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ profiles: ['turbo'] }));
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'unknown-profile' &&
        /"turbo"/.test(err.message) && /default, strict, security/.test(err.message)
    );
  });

  it('throws for non-boolean fix', () => {
    const dir = join(root, 'strict-fix-type');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ fix: 'yes' }));
    assert.throws(
      () => loadConfigFile(filePath),
      err => err instanceof ConfigError && err.kind === 'fix-type' && /"fix" must be a boolean/.test(err.message)
    );
  });
});

describe('loadConfig (lenient wrapper)', () => {
  it('still falls back to defaults for a missing explicit path', () => {
    assert.deepEqual(loadConfig(join(root, 'gone.json')), { rules: {}, fix: false });
  });

  it('rethrows unknown rule id errors', () => {
    const dir = join(root, 'lenient-unknown-rule');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ rules: { 'XX-99': 'off' } }));
    assert.throws(() => loadConfig(filePath), /Unknown rule id "XX-99"/);
  });

  it('rethrows bad severity errors', () => {
    const dir = join(root, 'lenient-severity');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ rules: { 'BP-01': 'banana' } }));
    assert.throws(() => loadConfig(filePath), /Invalid severity/);
  });

  it('rethrows unknown profile errors', () => {
    const dir = join(root, 'lenient-profile');
    mkdirSync(dir);
    const filePath = join(dir, 'rc.json');
    writeFileSync(filePath, JSON.stringify({ profiles: ['maximal'] }));
    assert.throws(() => loadConfig(filePath), /Unknown profile/);
  });
});
