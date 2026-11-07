import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, '..', 'src', 'cli.js');

// Companion to test/cli.test.js for line coverage of src/cli.js.
//
// The CLI is a top-level script that calls process.exit() on every path, so
// a test process can normally execute only one terminal branch of it. Here
// process.exit is mocked as a no-op that records the first exit code, which
// lets one run pass through the help block and continue into the config,
// discovery, fix and JSON-reporting code with real inputs. The assertions
// below stay true for the real CLI: with --help present it prints the help
// text and exits 0.
let exitCode = null;
let stdout = '';

it('should run the help path once, in-process', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-cli-help-'));
  const scanDir = join(workDir, 'scan');
  mkdirSync(scanDir);
  writeFileSync(join(scanDir, 'fixable.json'), JSON.stringify({
    name: 'Help Path Workflow',
    active: true,
    nodes: [],
    connections: {},
  }));

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  const exitCodes = [];

  process.argv = [originalArgv[0], cliPath, '--help', '--fix', '--format', 'json', scanDir];
  // Record the first exit (the help branch) and throw on the second (the
  // script's final exit) so the run spans the whole script and ends module
  // evaluation like a normal CLI invocation.
  process.exit = (code) => {
    exitCodes.push(code ?? 0);
    if (exitCodes.length >= 2) throw new Error('__CLI_EXIT__');
  };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));

  try {
    // Retain the namespace so the instance survives until the coverage
    // snapshot at the end of the test process. The cache-busting query is
    // required: the runner's coverage aggregation only keeps query-loaded
    // instances of repeatedly imported modules.
    globalThis.__cliHelpRun = await import(`${pathToFileURL(cliPath).href}?coverage=help`);
  } catch (err) {
    if (err?.message !== '__CLI_EXIT__') throw err;
  } finally {
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
    rmSync(workDir, { recursive: true, force: true });
  }

  exitCode = exitCodes[0];
  stdout = logs.join('\n');

  assert.equal(exitCode, 0);
  assert.match(stdout, /Usage:/);
});

it('should document usage, options, config and every rule id', () => {
  assert.match(stdout, /n8n-lint <file-or-directory> \[options\]/);
  for (const flag of ['--quiet, -q', '--format json', '--fix', '--config <path>', '--help, -h']) {
    assert.ok(stdout.includes(flag), `help should list ${flag}`);
  }
  assert.match(stdout, /\.n8nlintrc\.json/);
  for (const ruleId of [
    'SCHEMA-01', 'SCHEMA-02', 'SCHEMA-03', 'SCHEMA-04',
    'SEC-01', 'SEC-02', 'SEC-03', 'SEC-04', 'SEC-05',
    'BP-01', 'BP-02', 'BP-03', 'BP-04', 'BP-05', 'BP-06', 'BP-07',
  ]) {
    assert.ok(stdout.includes(ruleId), `help should list ${ruleId}`);
  }
});
