import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fixFile } from '../src/fixer.js';

let workDir;

const validWorkflow = () => ({
  name: 'Fixable Workflow',
  active: false,
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
});

const writeFile = (name, content) => {
  const filePath = join(workDir, name);
  writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return filePath;
};

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-fixer-test-'));
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('fixFile', () => {
  it('should strip meta.instanceId and keep other meta keys', () => {
    const workflow = validWorkflow();
    workflow.meta = { instanceId: 'abcdefgh1234', savedId: 42 };
    const file = writeFile('instance-id.json', workflow);

    const result = fixFile(file);
    assert.equal(result.fixed, true);
    assert.deepEqual(result.changes, ['Removed meta.instanceId']);

    const fixed = JSON.parse(readFileSync(file, 'utf-8'));
    assert.equal(fixed.meta.instanceId, undefined);
    assert.equal(fixed.meta.savedId, 42);
  });

  it('should remove meta entirely when instanceId was its only key', () => {
    const workflow = validWorkflow();
    workflow.meta = { instanceId: 'abcdefgh1234' };
    const file = writeFile('meta-only.json', workflow);

    fixFile(file);
    const fixed = JSON.parse(readFileSync(file, 'utf-8'));
    assert.equal('meta' in fixed, false);
  });

  it('should strip a string root-level id but keep numeric ids', () => {
    const withString = validWorkflow();
    withString.id = 'wf_abc123';
    const stringFile = writeFile('string-id.json', withString);
    const stringResult = fixFile(stringFile);
    assert.ok(stringResult.changes.includes('Removed root-level id'));
    assert.equal('id' in JSON.parse(readFileSync(stringFile, 'utf-8')), false);

    const withNumber = validWorkflow();
    withNumber.id = 987654;
    const numberFile = writeFile('number-id.json', withNumber);
    const numberResult = fixFile(numberFile);
    assert.equal(numberResult.fixed, false);
    assert.equal(JSON.parse(readFileSync(numberFile, 'utf-8')).id, 987654);
  });

  it('should set active: false', () => {
    const workflow = validWorkflow();
    workflow.active = true;
    const file = writeFile('active.json', workflow);

    const result = fixFile(file);
    assert.ok(result.changes.includes('Set active: false'));
    assert.equal(JSON.parse(readFileSync(file, 'utf-8')).active, false);
  });

  it('should apply all fixes at once and write pretty JSON with a newline', () => {
    const workflow = validWorkflow();
    workflow.meta = { instanceId: 'abcdefgh1234' };
    workflow.id = 'wf_abc123';
    workflow.active = true;
    const file = writeFile('everything.json', workflow);

    const result = fixFile(file);
    assert.equal(result.fixed, true);
    assert.equal(result.changes.length, 3);

    const raw = readFileSync(file, 'utf-8');
    assert.ok(raw.endsWith('\n'), 'file should end with a newline');
    const fixed = JSON.parse(raw);
    assert.equal(fixed.active, false);
    assert.equal('id' in fixed, false);
    assert.equal(fixed.meta, undefined);
    assert.equal(fixed.name, 'Fixable Workflow');
    assert.ok(raw.includes('\n  "name":'), 'file should be formatted with 2-space indent');
  });

  it('should leave clean workflows untouched', () => {
    const file = writeFile('clean.json', validWorkflow());
    const before = readFileSync(file, 'utf-8');

    const result = fixFile(file);
    assert.equal(result.fixed, false);
    assert.deepEqual(result.changes, []);
    assert.equal(result.error, undefined);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });

  it('should refuse to fix invalid JSON', () => {
    const file = writeFile('broken.json', '{ "name": ');
    const result = fixFile(file);
    assert.equal(result.fixed, false);
    assert.equal(result.error, 'Invalid JSON');
  });

  it('should skip files that are not n8n workflows without an error', () => {
    const file = writeFile('package.json', { name: 'x', version: '1.0.0' });
    const before = readFileSync(file, 'utf-8');
    const result = fixFile(file);
    assert.equal(result.fixed, false);
    assert.equal(result.error, null);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });

  it('should report unreadable files', () => {
    const result = fixFile(join(workDir, 'does-not-exist.json'));
    assert.equal(result.fixed, false);
    assert.match(result.error, /Cannot read file/);
  });

  it('should report write failures instead of throwing', () => {
    const readOnlyDir = join(workDir, 'readonly');
    mkdirSync(readOnlyDir);
    const file = join(readOnlyDir, 'locked.json');
    writeFileSync(file, JSON.stringify({ ...validWorkflow(), active: true }));
    chmodSync(readOnlyDir, 0o555);

    try {
      const result = fixFile(file);
      assert.equal(result.fixed, false);
      assert.deepEqual(result.changes, []);
      assert.match(result.error, /Cannot write file/);
    } finally {
      chmodSync(readOnlyDir, 0o755);
    }
  });
});
