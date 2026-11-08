import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const cliPath = join(repoRoot, 'src', 'cli.js');
const fixtures = (...parts) => resolve(__dirname, 'fixtures', ...parts);

const activeFixture = fixtures('invalid', 'active-true.json');
const rootIdFixture = fixtures('invalid', 'root-id.json');

let workDir;
let runCounter = 0;
// Keep strong references to every imported CLI module instance so earlier
// instances are not garbage collected before the coverage snapshot.
const loadedCliModules = [];
const originalCwd = process.cwd();

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-cli-config-'));
});

after(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Run the CLI in-process by importing src/cli.js with a fresh module URL.
 * Supports an optional cwd so config discovery can be exercised; the
 * original cwd is always restored.
 */
async function runCli(args, { cwd } = {}) {
  runCounter += 1;
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  let exitCode = null;

  if (cwd) process.chdir(cwd);

  process.argv = [originalArgv[0], cliPath, ...args];
  process.exit = (code) => {
    exitCode = code ?? 0;
    throw new Error('__CLI_EXIT__');
  };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));

  try {
    loadedCliModules.push(await import(`${pathToFileURL(cliPath).href}?run=${runCounter}`));
    exitCode = 0;
  } catch (err) {
    if (err?.message !== '__CLI_EXIT__') throw err;
  } finally {
    if (cwd) process.chdir(originalCwd);
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  return { exitCode, stdout: logs.join('\n'), stderr: errors.join('\n') };
}

const writeConfig = (name, content) => {
  const file = join(workDir, name);
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
};

describe('cli: config validation errors exit 2', () => {
  it('should exit 2 for an unknown rule id in the config file', async () => {
    const config = writeConfig('unknown-rule.json', { rules: { 'XX-99': 'off' } });
    const { exitCode, stderr } = await runCli(['--config', config, activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Unknown rule id "XX-99"/);
    assert.match(stderr, /BP-07/);
  });

  it('should exit 2 for a bad severity value', async () => {
    const config = writeConfig('bad-severity.json', { rules: { 'BP-01': 'maybe' } });
    const { exitCode, stderr } = await runCli(['--config', config, activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Invalid severity "maybe" for rule "BP-01"/);
    assert.match(stderr, /off, warn, error/);
  });

  it('should exit 2 for an unknown profile', async () => {
    const config = writeConfig('unknown-profile.json', { profiles: ['turbo'] });
    const { exitCode, stderr } = await runCli(['--config', config, activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Unknown profile "turbo"/);
    assert.match(stderr, /default, strict, security/);
  });

  it('should exit 2 for a non-array profiles value', async () => {
    const config = writeConfig('profiles-string.json', { profiles: 'strict' });
    const { exitCode, stderr } = await runCli(['--config', config, activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: "profiles" must be an array/);
  });

  it('should exit 2 for an unknown top-level config key', async () => {
    const config = writeConfig('unknown-key.json', { rulez: { 'BP-01': 'off' } });
    const { exitCode, stderr } = await runCli(['--config', config, activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Unknown config option "rulez"/);
  });

  it('should exit 2 for a missing --config path', async () => {
    const { exitCode, stderr } = await runCli(['--config', join(workDir, 'gone.json'), activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Config file not found/);
  });

  it('should exit 2 for a malformed --rule value', async () => {
    const { exitCode, stderr } = await runCli(['--rule', 'BP-05', activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Invalid --rule value "BP-05"/);
    assert.match(stderr, /--rule BP-05=error/);
  });

  it('should exit 2 for an unknown rule id in --rule', async () => {
    const { exitCode, stderr } = await runCli(['--rule', 'XX-99=off', activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Unknown rule id "XX-99" in --rule/);
  });

  it('should exit 2 for a bad severity in --rule', async () => {
    const { exitCode, stderr } = await runCli(['--rule', 'BP-01=banana', activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Invalid --rule value "BP-01=banana"/);
  });

  it('should exit 2 for --rule SCHEMA-01=off since SCHEMA-01 always runs', async () => {
    const { exitCode, stderr } = await runCli(['--rule', 'SCHEMA-01=off', activeFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /SCHEMA-01/);
  });

  it('should exit 2 when --rule is the last argument with no value', async () => {
    const { exitCode, stderr } = await runCli(['--rule']);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: --rule expects a value/);
  });
});

describe('cli: config discovery from the cwd upward', () => {
  it('should pick up a config from a parent directory of the cwd', async () => {
    const project = join(workDir, 'project');
    const deep = join(project, 'deep');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(project, '.n8nlintrc.json'), JSON.stringify({ rules: { 'BP-01': 'off' } }));

    const { exitCode, stdout } = await runCli([activeFixture], { cwd: deep });
    assert.equal(exitCode, 0, 'BP-01 disabled by the discovered config');
    assert.ok(!stdout.includes('[BP-01]'));
  });

  it('should prefer the nearest config when several exist', async () => {
    // farDir holds the escalating config (SEC-03: error), project holds a
    // nearer one that only disables BP-01. Starting from project/deep the
    // near config must win, so SEC-03 stays a warning and the run passes.
    const farDir = join(workDir, 'nearest-chain');
    const project = join(farDir, 'project');
    const deep = join(project, 'deep');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(farDir, '.n8nlintrc.json'), JSON.stringify({ rules: { 'SEC-03': 'error' } }));
    writeFileSync(join(project, '.n8nlintrc.json'), JSON.stringify({ rules: { 'BP-01': 'off' } }));

    const near = await runCli([rootIdFixture], { cwd: deep });
    assert.equal(near.exitCode, 0, 'SEC-03 stays a warning: the nearest config won');
    assert.match(near.stdout, /1 warning/);

    // Control: one level up the far config becomes the nearest one and the
    // same file fails, proving both configs are live and order decides.
    const far = await runCli([rootIdFixture], { cwd: farDir });
    assert.equal(far.exitCode, 1, 'the far config escalates SEC-03 when it is nearest');
  });

  it('should let an explicit --config override discovery', async () => {
    const project = join(workDir, 'explicit');
    const deep = join(project, 'deep');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(project, '.n8nlintrc.json'), JSON.stringify({ rules: { 'BP-01': 'off' } }));
    const explicit = writeConfig('explicit-override.json', { rules: { 'BP-01': 'error' } });

    const { exitCode, stdout } = await runCli(['--config', explicit, activeFixture], { cwd: deep });
    assert.equal(exitCode, 1, 'explicit config re-enables BP-01');
    assert.match(stdout, /\[BP-01\]/);
  });
});

describe('cli: profiles end to end', () => {
  it('strict escalates warnings to errors and fails the run', async () => {
    const config = writeConfig('strict.json', { profiles: ['strict'] });
    const { exitCode, stdout } = await runCli(['--config', config, rootIdFixture]);
    assert.equal(exitCode, 1, 'SEC-03 warning becomes an error under strict');
    assert.match(stdout, /1 error/);
    assert.match(stdout, /\[SEC-03\]/);
  });

  it('security disables best-practice rules', async () => {
    const config = writeConfig('security.json', { profiles: ['security'] });
    const { exitCode, stdout } = await runCli(['--config', config, activeFixture]);
    assert.equal(exitCode, 0, 'BP-01 is off under the security profile');
    assert.ok(!stdout.includes('[BP-01]'));
  });

  it('security escalates security warnings to errors', async () => {
    const config = writeConfig('security2.json', { profiles: ['security'] });
    const { exitCode, stdout } = await runCli(['--config', config, rootIdFixture]);
    assert.equal(exitCode, 1, 'SEC-03 becomes an error under security');
    assert.match(stdout, /\[SEC-03\]/);
  });

  it('explicit rules entries beat the profile', async () => {
    const config = writeConfig('strict-off.json', {
      profiles: ['strict'],
      rules: { 'SEC-03': 'off' },
    });
    const { exitCode, stdout } = await runCli(['--config', config, rootIdFixture]);
    assert.equal(exitCode, 0, 'SEC-03 disabled despite the strict profile');
    assert.ok(!stdout.includes('[SEC-03]'));
  });
});

describe('cli: --rule precedence over the config file', () => {
  it('should let --rule disable a rule the file escalates', async () => {
    const config = writeConfig('sec03-error.json', { rules: { 'SEC-03': 'error' } });
    const { exitCode, stdout } = await runCli(['--config', config, '--rule', 'SEC-03=off', rootIdFixture]);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('[SEC-03]'));
  });

  it('should let --rule re-enable a rule the file disables', async () => {
    const config = writeConfig('bp01-off.json', { rules: { 'BP-01': 'off' } });
    const { exitCode, stdout } = await runCli(['--config', config, '--rule', 'BP-01=error', activeFixture]);
    assert.equal(exitCode, 1);
    assert.match(stdout, /\[BP-01\]/);
  });

  it('should apply multiple --rule flags together', async () => {
    const config = writeConfig('multi.json', { profiles: ['strict'] });
    const { exitCode, stdout } = await runCli([
      '--config', config,
      '--rule', 'SEC-03=off',
      '--rule', 'BP-01=off',
      activeFixture,
    ]);
    assert.equal(exitCode, 0, 'both rules disabled on top of strict');
    assert.ok(!stdout.includes('[BP-01]'));
  });
});

describe('cli: --print-config', () => {
  it('should print the default resolved config without a config file', async () => {
    const empty = join(workDir, 'no-config-here');
    mkdirSync(empty);
    const { exitCode, stdout } = await runCli(['--print-config'], { cwd: empty });
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.configFile, null);
    assert.deepEqual(parsed.profiles, []);
    assert.equal(parsed.fix, false);
    assert.equal(Object.keys(parsed.rules).length, 16);
    assert.equal(parsed.rules['SCHEMA-02'], 'error');
    assert.equal(parsed.rules['SEC-03'], 'warn');
    assert.equal(parsed.rules['BP-05'], 'warn');
  });

  it('should print the composed config: file + profiles + CLI overrides', async () => {
    const config = writeConfig('composed.json', {
      profiles: ['strict'],
      rules: { 'BP-06': 'warn' },
      fix: true,
    });
    const { exitCode, stdout } = await runCli([
      '--config', config,
      '--rule', 'BP-06=off',
      '--rule', 'BP-01=warn',
      '--print-config',
    ]);
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.configFile, resolve(config));
    assert.deepEqual(parsed.profiles, ['strict']);
    assert.equal(parsed.fix, true);
    assert.equal(parsed.rules['BP-06'], 'off', 'CLI --rule wins over the file entry');
    assert.equal(parsed.rules['BP-01'], 'warn', 'CLI --rule wins over the strict profile');
    assert.equal(parsed.rules['SEC-03'], 'error', 'strict escalates untouched rules');
    assert.equal(parsed.rules['SCHEMA-02'], 'error');
  });

  it('should reflect the --fix flag in the printed config', async () => {
    const { exitCode, stdout } = await runCli(['--print-config', '--fix']);
    const parsed = JSON.parse(stdout);
    assert.equal(exitCode, 0);
    assert.equal(parsed.fix, true);
  });

  it('should ignore path arguments and not lint', async () => {
    const { exitCode, stdout } = await runCli(['--print-config', activeFixture]);
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout);
    assert.ok(parsed.rules, 'config JSON printed, no lint output');
    assert.ok(!stdout.includes('file checked'));
  });

  it('should work without a path argument (no help screen)', async () => {
    const { exitCode, stdout } = await runCli(['--print-config']);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('Usage:'));
    assert.ok(JSON.parse(stdout).rules);
  });

  it('should exit 2 for an invalid config even with --print-config', async () => {
    const config = writeConfig('print-invalid.json', { rules: { 'XX-99': 'off' } });
    const { exitCode, stderr } = await runCli(['--print-config', '--config', config]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Config error: Unknown rule id "XX-99"/);
  });
});
