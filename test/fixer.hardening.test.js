import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixFile, hasConflictMarkers } from '../src/fixer.js';

let workDir;

const validWorkflow = () => ({
  name: 'Hardening Workflow',
  active: false,
  nodes: [],
  connections: {},
  settings: {},
});

const writeFile = (name, content) => {
  const filePath = join(workDir, name);
  writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return filePath;
};

const messyWorkflow = () => {
  const workflow = validWorkflow();
  workflow.id = 'wf_messy_123';
  workflow.meta = { instanceId: 'abcdefgh1234' };
  workflow.active = true;
  return workflow;
};

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-fixer-hardening-'));
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('hasConflictMarkers', () => {
  it('should detect git and diff3 conflict markers at line start', () => {
    for (const marker of ['<<<<<<< HEAD', '=======', '>>>>>>> feature', '||||||| base']) {
      assert.equal(hasConflictMarkers(`{\n${marker}\n}\n`), true, marker);
    }
  });

  it('should ignore markers inside normal JSON lines', () => {
    assert.equal(hasConflictMarkers('{ "note": "a ======= b" }\n'), false);
    assert.equal(hasConflictMarkers(JSON.stringify(messyWorkflow(), null, 2)), false);
  });
});

describe('fixFile idempotence', () => {
  it('should report no changes and write nothing on a second run', () => {
    const file = writeFile('twice.json', messyWorkflow());

    const first = fixFile(file);
    assert.equal(first.fixed, true);
    const afterFirst = readFileSync(file, 'utf-8');

    const second = fixFile(file);
    assert.equal(second.fixed, false);
    assert.deepEqual(second.changes, []);
    assert.equal(second.error, undefined);
    assert.equal(readFileSync(file, 'utf-8'), afterFirst, 'second run leaves the file untouched');
  });

  it('should be idempotent across many runs', () => {
    const file = writeFile('many.json', messyWorkflow());
    fixFile(file);
    const afterFirst = readFileSync(file, 'utf-8');
    for (let i = 0; i < 3; i++) {
      const again = fixFile(file);
      assert.equal(again.fixed, false);
      assert.equal(again.changes.length, 0);
    }
    assert.equal(readFileSync(file, 'utf-8'), afterFirst);
  });

  it('should rewrite an already-fixed file to the same bytes', () => {
    // Even when a fixable file is hand-formatted differently, applying the
    // fix twice converges: the first run normalizes, later runs write never.
    const workflow = messyWorkflow();
    const file = join(workDir, 'converge.json');
    writeFileSync(file, JSON.stringify(workflow)); // minified
    fixFile(file);
    const normalized = readFileSync(file, 'utf-8');
    const second = fixFile(file);
    assert.equal(second.fixed, false);
    assert.equal(readFileSync(file, 'utf-8'), normalized);
  });
});

describe('fixFile dry-run mode', () => {
  it('should compute changes and a unified diff without writing', () => {
    const file = writeFile('dry.json', messyWorkflow());
    const before = readFileSync(file, 'utf-8');

    const result = fixFile(file, { dryRun: true });

    assert.equal(result.fixed, false, 'nothing was written');
    assert.deepEqual(result.changes, [
      'Removed meta.instanceId',
      'Removed root-level id',
      'Set active: false',
    ]);
    assert.ok(result.diff.includes(`--- ${file}`));
    assert.ok(result.diff.includes(`+++ ${file}`));
    assert.match(result.diff, /@@ -\d+,\d+ \+\d+,\d+ @@/);
    assert.match(result.diff, /^-  "active": true,$/m);
    assert.match(result.diff, /^\+  "active": false,$/m);
    assert.equal(readFileSync(file, 'utf-8'), before, 'dry-run leaves the file untouched');
  });

  it('should return no diff for a clean file', () => {
    const file = writeFile('clean.json', validWorkflow());
    const result = fixFile(file, { dryRun: true });
    assert.equal(result.fixed, false);
    assert.deepEqual(result.changes, []);
    assert.equal(result.diff, null);
  });
});

describe('fixFile conflict-marker refusal', () => {
  it('should refuse to fix a conflicted file and leave it untouched', () => {
    const conflicted = [
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
    ].join('\n');
    const file = writeFile('conflict.json', conflicted);
    const before = readFileSync(file, 'utf-8');

    const result = fixFile(file);
    assert.equal(result.fixed, false);
    assert.deepEqual(result.changes, []);
    assert.match(result.error, /conflict markers/i);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });

  it('should refuse in dry-run mode too', () => {
    const file = writeFile('conflict-dry.json', '{\n<<<<<<< HEAD\n"x": 1\n=======\n"x": 2\n>>>>>>> b\n}\n');
    const before = readFileSync(file, 'utf-8');
    const result = fixFile(file, { dryRun: true });
    assert.equal(result.fixed, false);
    assert.match(result.error, /conflict markers/i);
    assert.equal(result.diff, null);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });

  it('should keep the plain Invalid JSON error for marker-free broken files', () => {
    const result = fixFile(writeFile('plain-broken.json', '{ "name": '));
    assert.equal(result.error, 'Invalid JSON');
  });
});
