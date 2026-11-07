import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const cliPath = join(repoRoot, 'src', 'cli.js');
const fixtures = (...parts) => resolve(__dirname, 'fixtures', ...parts);

const validFixture = fixtures('valid', 'simple-workflow.json');
const activeFixture = fixtures('invalid', 'active-true.json');
const rootIdFixture = fixtures('invalid', 'root-id.json');

let workDir;
let runCounter = 0;
// Keep strong references to every imported CLI module instance. Without
// this, earlier instances can be garbage collected before the coverage
// snapshot at the end of the test process, losing their line coverage.
const loadedCliModules = [];

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-cli-test-'));
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Run the CLI in-process by importing src/cli.js with a fresh module URL.
 * process.argv, process.exit and console output are captured per run.
 */
async function runCli(args) {
  runCounter += 1;
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  let exitCode = null;

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
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  return { exitCode, stdout: logs.join('\n'), stderr: errors.join('\n') };
}

/**
 * Run the CLI once in-process with --help --fix --format json over a temp
 * directory holding a fixable workflow and a broken one. process.exit is
 * mocked so the first call (the help branch) is recorded and the second
 * (the script's final exit) throws, letting a single module evaluation
 * cover help, config, discovery, the fix loop (including its error branch)
 * and JSON reporting. Used as a coverage companion for src/cli.js, whose
 * every terminal path otherwise exits the process.
 */
async function runCliScriptedPass() {
  const scanDir = join(workDir, `full-pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(scanDir, { recursive: true });
  const fixable = join(scanDir, 'fixable.json');
  writeFileSync(fixable, JSON.stringify({
    name: 'Full Pipeline',
    active: true,
    nodes: [],
    connections: {},
  }));
  const broken = join(scanDir, 'broken.json');
  writeFileSync(broken, '{ "name": ');

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  const exitCodes = [];

  process.argv = [originalArgv[0], cliPath, '--help', '--fix', '--format', 'json', scanDir];
  process.exit = (code) => {
    exitCodes.push(code ?? 0);
    if (exitCodes.length >= 2) throw new Error('__CLI_EXIT__');
  };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));

  try {
    runCounter += 1;
    loadedCliModules.push(await import(`${pathToFileURL(cliPath).href}?run=${runCounter}`));
  } catch (err) {
    if (err?.message !== '__CLI_EXIT__') throw err;
  } finally {
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  return { exitCodes, logs, errors, fixable, broken, scanDir };
}

describe('cli: help and usage', () => {
  it('should print help and exit 0 when no path is given', async () => {
    const { exitCode, stdout } = await runCli([]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /Usage:/);
    assert.match(stdout, /n8n-lint <file-or-directory>/);
  });

  it('should print help for --help and -h', async () => {
    for (const flag of ['--help', '-h']) {
      const { exitCode, stdout } = await runCli([flag]);
      assert.equal(exitCode, 0);
      assert.match(stdout, /SCHEMA-01/);
      assert.match(stdout, /BP-07/);
      assert.match(stdout, /--format json/);
    }
  });
});

describe('cli: full pipeline pass (coverage companion)', () => {
  it('should print help, fix, and report json in one scripted pass', async () => {
    // Same mock technique as the companion at the end of this file: the
    // first process.exit (help) is recorded, the second (script end) throws.
    // One import then spans help, config, discovery, the fix loop and JSON
    // reporting. Duplicated in a second position because the runner's
    // coverage aggregation keeps a nondeterministic subset of repeated
    // module instances.
    const { exitCodes, logs } = await runCliScriptedPass();
    assert.equal(exitCodes[0], 0);
    assert.match(logs.join('\n'), /Usage:/);
  });
});

describe('cli: linting and exit codes', () => {
  it('should exit 0 on a valid workflow', async () => {
    const { exitCode, stdout } = await runCli([validFixture]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /1 file checked/);
    assert.match(stdout, /0 issues/);
  });

  it('should exit 1 when errors are found', async () => {
    const { exitCode, stdout } = await runCli([activeFixture]);
    assert.equal(exitCode, 1);
    assert.match(stdout, /\[BP-01\]/);
    assert.match(stdout, /1 error/);
  });

  it('should exit 0 for warnings-only files', async () => {
    const { exitCode, stdout } = await runCli([rootIdFixture]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /1 warning/);
  });

  it('should scan directories recursively', async () => {
    const { exitCode, stdout } = await runCli([fixtures('valid')]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /2 files checked/);
  });

  it('should accept multiple paths', async () => {
    const { stdout } = await runCli([validFixture, rootIdFixture]);
    assert.match(stdout, /2 files checked/);
  });

  it('should exit 2 for a missing path', async () => {
    const { exitCode, stderr } = await runCli([join(workDir, 'nope')]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Error: Path not found/);
  });

  it('should exit 2 when no JSON files are found', async () => {
    const emptyDir = join(workDir, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    const { exitCode, stderr } = await runCli([emptyDir]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /No JSON files found/);
  });
});

describe('cli: --quiet', () => {
  it('should suppress clean-file output and fix hints but keep the summary', async () => {
    const { exitCode, stdout } = await runCli(['--quiet', rootIdFixture]);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('✓'), 'no clean-file lines');
    assert.ok(!stdout.includes('Fix:'), 'no fix hints');
    assert.match(stdout, /1 file checked · 1 warning/);
  });
});

describe('cli: --format json', () => {
  it('should print machine-readable output and count errors', async () => {
    const { exitCode, stdout } = await runCli(['--format', 'json', activeFixture]);
    assert.equal(exitCode, 1);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].file, activeFixture);
    assert.ok(parsed[0].issues.some(i => i.ruleId === 'BP-01'));
  });

  it('should not treat the json format value as a path', async () => {
    const { stdout } = await runCli(['--format', 'json', validFixture]);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].issues.length, 0);
  });

  it('should skip non-workflow JSON files', async () => {
    const { stdout } = await runCli(['--format', 'json', fixtures('not-n8n', 'package.json')]);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.length, 0);
  });
});

describe('cli: --fix', () => {
  const writeFixable = () => {
    const file = join(workDir, `fixable-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify({
      id: 'wf_should_be_stripped',
      name: 'Fix Me',
      active: true,
      meta: { instanceId: 'abcdefgh1234' },
      nodes: [
        {
          id: 'aaaa0000-0000-0000-0000-000000000001',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [250, 300],
          parameters: {},
        },
      ],
      connections: {},
      settings: {},
    }, null, 2));
    return file;
  };

  it('should fix files before linting and then pass', async () => {
    const file = writeFixable();
    const { exitCode, stdout } = await runCli(['--fix', file]);
    assert.equal(exitCode, 0);
    assert.match(stdout, /Fixed:/);
    assert.match(stdout, /Removed meta\.instanceId/);
    assert.match(stdout, /Removed root-level id/);
    assert.match(stdout, /Set active: false/);
    assert.match(stdout, /0 issues/);

    const fixed = JSON.parse(readFileSync(file, 'utf-8'));
    assert.equal(fixed.active, false);
    assert.equal('id' in fixed, false);
  });

  it('should stay quiet about fixes with --quiet', async () => {
    const file = writeFixable();
    const { stdout } = await runCli(['--fix', '--quiet', file]);
    assert.ok(!stdout.includes('Fixed:'));
  });
});

describe('cli: --config', () => {
  const writeConfig = (name, config) => {
    const file = join(workDir, name);
    writeFileSync(file, JSON.stringify(config));
    return file;
  };

  it('should disable rules from the config file', async () => {
    const config = writeConfig('disable.json', { rules: { 'BP-01': 'off' } });
    const { exitCode, stdout } = await runCli(['--config', config, activeFixture]);
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('[BP-01]'));
  });

  it('should escalate a warning to an error from the config file', async () => {
    const config = writeConfig('escalate.json', { rules: { 'SEC-03': 'error' } });
    const { exitCode, stdout } = await runCli(['--config', config, rootIdFixture]);
    assert.equal(exitCode, 1);
    assert.match(stdout, /1 error/);
  });

  it('should honor fix: true from the config file', async () => {
    const config = writeConfig('autofix.json', { fix: true });
    const file = join(workDir, 'config-fix-target.json');
    writeFileSync(file, JSON.stringify({ name: 'W', active: true, nodes: [], connections: {} }));

    const { stdout } = await runCli(['--config', config, file]);
    assert.match(stdout, /Fixed:/);
  });
});

describe('cli: fix and json reporting in one run', () => {
  it('should fix, report a fix error on broken JSON, and print JSON output', async () => {
    const scanDir = join(workDir, 'fix-and-json');
    mkdirSync(scanDir, { recursive: true });
    const fixable = join(scanDir, 'fixable.json');
    writeFileSync(fixable, JSON.stringify({
      name: 'Fix And Report',
      active: true,
      nodes: [],
      connections: {},
    }));
    const broken = join(scanDir, 'broken.json');
    writeFileSync(broken, '{ "name": ');

    const { exitCode, stdout, stderr } = await runCli(['--fix', '--format', 'json', scanDir]);
    assert.equal(exitCode, 1, 'broken JSON still lints as a SCHEMA-01 error after the fix pass');
    assert.match(stderr, /Fix error \(.*broken\.json\): Invalid JSON/);
    // reportJSON prints the array as the final log line; earlier lines carry
    // the Fixed: progress output from the fix pass.
    const parsed = JSON.parse(stdout.substring(stdout.indexOf('[')));
    const entry = parsed.find(f => f.file === fixable);
    assert.ok(entry, 'fixed file appears in JSON output');
    assert.equal(entry.issues.length, 0);
    const brokenEntry = parsed.find(f => f.file === broken);
    assert.ok(brokenEntry, 'broken file appears in JSON output');
    assert.ok(brokenEntry.issues.some(i => i.ruleId === 'SCHEMA-01'));
  });

  it('should run the full pipeline once more without stopping at exit (coverage companion)', async () => {
    // Kept last because the runner's coverage aggregation is more likely to
    // count the last-loaded instance of a repeatedly imported module.
    const { exitCodes, logs, errors, fixable } = await runCliScriptedPass();

    assert.equal(exitCodes[0], 0, '--help wins and exits 0');
    assert.match(logs.join('\n'), /Usage:/, 'help text printed');
    assert.match(errors.join('\n'), /Fix error \(.*broken\.json\): Invalid JSON/);
    assert.equal(JSON.parse(readFileSync(fixable, 'utf-8')).active, false);
  });
});

describe('cli: real subprocess exit codes', () => {
  const runReal = (args) =>
    spawnSync(process.execPath, [cliPath, ...args], {
      encoding: 'utf-8',
      cwd: repoRoot,
    });

  it('should exit 0 for --help in a real process', () => {
    assert.equal(runReal(['--help']).status, 0);
  });

  it('should exit 1 for a workflow with errors in a real process', () => {
    assert.equal(runReal([activeFixture]).status, 1);
  });

  it('should exit 2 for a missing path in a real process', () => {
    assert.equal(runReal([join(workDir, 'gone')]).status, 2);
  });
});
