import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, '..', 'src', 'cli.js');

let workDir;
let runCounter = 0;
const loadedCliModules = [];

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-cli-fix-'));
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

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
    loadedCliModules.push(await import(`${pathToFileURL(cliPath).href}?fixdry=${runCounter}`));
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

const fixableWorkflow = () => ({
  id: 'wf_cli_dry_1',
  name: 'CLI Dry Run',
  active: true,
  meta: { instanceId: 'abcdefgh1234' },
  nodes: [],
  connections: {},
  settings: {},
});

const writeFixable = (name) => {
  const file = join(workDir, name);
  writeFileSync(file, JSON.stringify(fixableWorkflow(), null, 2));
  return file;
};

describe('cli: --fix-dry-run', () => {
  it('should print a unified diff without writing the file', async () => {
    const file = writeFixable('dry-run.json');
    const before = readFileSync(file, 'utf-8');

    const { exitCode, stdout } = await runCli(['--fix-dry-run', file]);

    assert.ok(stdout.includes(`--- ${file}`));
    assert.ok(stdout.includes(`+++ ${file}`));
    assert.match(stdout, /@@ -\d+,\d+ \+\d+,\d+ @@/);
    assert.match(stdout, /^-  "active": true,$/m);
    assert.match(stdout, /^\+  "active": false,$/m);
    assert.equal(readFileSync(file, 'utf-8'), before, 'the file was not written');
    // Nothing was fixed, so both fixable errors (SEC-02, BP-01) remain and
    // the run still fails by severity.
    assert.equal(exitCode, 1);
    assert.match(stdout, /2 errors/);
  });

  it('should win over --fix and write nothing', async () => {
    const file = writeFixable('dry-beats-fix.json');
    const before = readFileSync(file, 'utf-8');

    const { stdout } = await runCli(['--fix', '--fix-dry-run', file]);

    assert.match(stdout, /@@ -\d+,\d+ \+\d+,\d+ @@/);
    assert.ok(!stdout.includes('Fixed:'), 'no fix output in dry-run mode');
    assert.equal(readFileSync(file, 'utf-8'), before, 'the file was not written');
  });

  it('should win over fix: true in the config file', async () => {
    const file = writeFixable('dry-beats-config.json');
    const config = join(workDir, 'autofix-config.json');
    writeFileSync(config, JSON.stringify({ fix: true }));
    const before = readFileSync(file, 'utf-8');

    const { stdout } = await runCli(['--config', config, '--fix-dry-run', file]);

    assert.match(stdout, /@@ -\d+,\d+ \+\d+,\d+ @@/);
    assert.equal(readFileSync(file, 'utf-8'), before, 'the file was not written');
  });

  it('should print nothing for files without fixable issues', async () => {
    const clean = join(workDir, 'already-clean.json');
    writeFileSync(clean, JSON.stringify({
      name: 'Already Clean',
      active: false,
      nodes: [],
      connections: {},
    }, null, 2));
    const before = readFileSync(clean, 'utf-8');

    const { exitCode, stdout } = await runCli(['--fix-dry-run', clean]);

    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('---'), 'no diff header for a clean file');
    assert.equal(readFileSync(clean, 'utf-8'), before);
  });
});

describe('cli: --fix idempotence', () => {
  it('should fix once and report nothing on the second run', async () => {
    const file = writeFixable('idempotent.json');

    const first = await runCli(['--fix', file]);
    assert.equal(first.exitCode, 0);
    assert.match(first.stdout, /Fixed:/);
    const afterFirst = readFileSync(file, 'utf-8');

    const second = await runCli(['--fix', file]);
    assert.equal(second.exitCode, 0);
    assert.ok(!second.stdout.includes('Fixed:'), 'second run fixes nothing');
    assert.match(second.stdout, /0 issues/);
    assert.equal(readFileSync(file, 'utf-8'), afterFirst, 'second run writes nothing');
  });
});

describe('cli: conflict-marker refusal', () => {
  it('should report a fix error for a conflicted file and still lint it', async () => {
    const file = join(workDir, 'conflicted.json');
    writeFileSync(file, [
      '{',
      '  "name": "Conflicted",',
      '<<<<<<< HEAD',
      '  "active": true,',
      '=======',
      '  "active": false,',
      '>>>>>>> feature',
      '  "nodes": [],',
      '  "connections": {}',
      '}',
    ].join('\n'));
    const before = readFileSync(file, 'utf-8');

    const { exitCode, stdout, stderr } = await runCli(['--fix', file]);

    assert.match(stderr, new RegExp(`Fix error \\(${file.replace(/[/\\]/g, '\\$&')}\\): Unresolved merge conflict markers`));
    assert.equal(readFileSync(file, 'utf-8'), before, 'the conflicted file was not touched');
    // The conflicted file is invalid JSON, so linting still reports SCHEMA-01
    assert.equal(exitCode, 1);
    assert.match(stdout, /SCHEMA-01/);
  });
});
