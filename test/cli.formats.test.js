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

let workDir;
let runCounter = 0;
const loadedCliModules = [];

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-cli-formats-'));
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
    loadedCliModules.push(await import(`${pathToFileURL(cliPath).href}?formats=${runCounter}`));
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

describe('cli: --format text', () => {
  it('should behave exactly like the default output', async () => {
    const plain = await runCli([validFixture]);
    const text = await runCli(['--format', 'text', validFixture]);
    assert.equal(plain.exitCode, 0);
    assert.equal(text.exitCode, 0);
    assert.equal(text.stdout, plain.stdout);
    assert.match(text.stdout, /1 file checked · 0 issues/);
  });
});

describe('cli: --format json', () => {
  it('should print the documented stable array shape', async () => {
    const { exitCode, stdout } = await runCli(['--format', 'json', activeFixture]);
    assert.equal(exitCode, 1);

    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed), 'top level is a findings array');
    assert.equal(parsed.length, 1);
    assert.deepEqual(Object.keys(parsed[0]), ['file', 'issues']);
    assert.equal(parsed[0].file, activeFixture);
    for (const issue of parsed[0].issues) {
      assert.deepEqual(Object.keys(issue), ['ruleId', 'severity', 'message', 'node', 'fix']);
    }
    assert.ok(parsed[0].issues.some(i => i.ruleId === 'BP-01' && i.severity === 'error'));
    assert.ok(parsed[0].issues.every(i => i.fix === null || typeof i.fix === 'string'));
  });

  it('should exit 0 and print an empty array for a clean run', async () => {
    const { exitCode, stdout } = await runCli(['--format', 'json', validFixture]);
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout);
    assert.deepEqual(parsed, [{ file: validFixture, issues: [] }]);
  });
});

describe('cli: --format html', () => {
  it('should print one self-contained html document with the summary', async () => {
    const { exitCode, stdout } = await runCli(['--format', 'html', activeFixture]);
    assert.equal(exitCode, 1);
    assert.ok(stdout.startsWith('<!DOCTYPE html>'));
    assert.ok(stdout.trimEnd().endsWith('</html>'));
    assert.ok(stdout.includes('<style>'));
    assert.ok(!/<script/i.test(stdout));
    assert.match(stdout, /1 file checked/);
    assert.match(stdout, /1 error/);
    assert.ok(stdout.includes('BP-01'));
    assert.ok(stdout.includes('active: true'));
  });

  it('should escape findings that contain html-sensitive characters', async () => {
    const scanDir = join(workDir, 'escaping');
    mkdirSync(scanDir, { recursive: true });
    const file = join(scanDir, 'spicy.json');
    writeFileSync(file, JSON.stringify({
      name: 'Spicy',
      active: false,
      nodes: [{ id: 'n1', name: 'Node <b>&"quoted"</b>', type: 'n8n-nodes-base.set' }],
      connections: {},
    }, null, 2));

    const { stdout } = await runCli(['--format', 'html', file]);
    assert.ok(stdout.includes('Node &lt;b&gt;&amp;&quot;quoted&quot;&lt;/b&gt;'));
    assert.ok(!stdout.includes('<b>'), 'raw tags from findings never appear');
  });

  it('should stay a clean single document for a clean run', async () => {
    const { exitCode, stdout } = await runCli(['--format', 'html', validFixture]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.startsWith('<!DOCTYPE html>'));
    assert.match(stdout, /0 errors/);
    assert.match(stdout, /No findings\./);
  });
});

describe('cli: --format validation (exit code 2)', () => {
  it('should exit 2 for an unknown format value', async () => {
    const { exitCode, stderr } = await runCli(['--format', 'xml', validFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Usage error: unknown format "xml"/);
    assert.match(stderr, /text, json, html/);
  });

  it('should exit 2 when --format has no value', async () => {
    const { exitCode, stderr } = await runCli(['--format']);
    assert.equal(exitCode, 2);
    assert.match(stderr, /Usage error: --format expects one of: text, json, html/);
  });

  it('should exit 2 when the value looks like another flag', async () => {
    const { exitCode, stderr } = await runCli(['--format', '--quiet', validFixture]);
    assert.equal(exitCode, 2);
    assert.match(stderr, /--format expects one of/);
  });
});

describe('cli: real subprocess format exit codes', () => {
  const runReal = (args) =>
    spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf-8', cwd: repoRoot });

  it('should exit 1 for --format json on a flawed workflow', () => {
    const run = runReal(['--format', 'json', activeFixture]);
    assert.equal(run.status, 1);
    assert.doesNotThrow(() => JSON.parse(run.stdout));
  });

  it('should exit 2 for a bogus format in a real process', () => {
    assert.equal(runReal(['--format', 'yaml', activeFixture]).status, 2);
  });
});
