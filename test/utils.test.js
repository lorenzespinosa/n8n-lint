import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverFiles, parseJSON, isN8nWorkflow } from '../src/utils.js';

let workDir;

const writeFile = (parts, content = '{}') => {
  const filePath = join(workDir, ...parts);
  writeFileSync(filePath, content);
  return filePath;
};

const makeDir = (parts) => {
  const dirPath = join(workDir, ...parts);
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'n8n-lint-utils-test-'));
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('discoverFiles', () => {
  it('should return a single resolved path for a JSON file argument', () => {
    const file = writeFile(['single.json']);
    assert.deepEqual(discoverFiles(file), [resolve(file)]);
  });

  it('should return nothing for a non-JSON file argument', () => {
    const file = writeFile(['notes.txt'], 'hello');
    assert.deepEqual(discoverFiles(file), []);
  });

  it('should discover JSON files in nested directories', () => {
    makeDir(['tree', 'sub', 'deep']);
    const top = writeFile(['tree', 'top.json']);
    const deep = writeFile(['tree', 'sub', 'deep', 'deep.json']);
    const found = discoverFiles(join(workDir, 'tree'));
    assert.equal(found.length, 2);
    assert.ok(found.includes(resolve(top)));
    assert.ok(found.includes(resolve(deep)));
  });

  it('should skip hidden directories and node_modules', () => {
    makeDir(['scan', '.hidden']);
    makeDir(['scan', 'node_modules']);
    makeDir(['scan', 'ok']);
    writeFile(['scan', '.hidden', 'secret.json']);
    writeFile(['scan', 'node_modules', 'dep.json']);
    const ok = writeFile(['scan', 'ok', 'fine.json']);
    assert.deepEqual(discoverFiles(join(workDir, 'scan')), [resolve(ok)]);
  });

  it('should throw for a path that does not exist', () => {
    assert.throws(
      () => discoverFiles(join(workDir, 'missing-path')),
      /Path not found/
    );
  });

  it('should skip symlinked files and directories', () => {
    const target = writeFile(['link-target.json']);
    const fileLink = join(workDir, 'file-link.json');
    symlinkSync(target, fileLink);

    const dir = makeDir(['link-target-dir']);
    writeFile(['link-target-dir', 'inner.json']);
    const dirLink = join(workDir, 'dir-link');
    symlinkSync(dir, dirLink);

    assert.deepEqual(discoverFiles(fileLink), []);
    assert.deepEqual(discoverFiles(dirLink), []);
  });

  it('should skip broken symlinks without throwing', () => {
    const broken = join(workDir, 'broken-link.json');
    symlinkSync(join(workDir, 'nowhere.json'), broken);
    assert.deepEqual(discoverFiles(broken), []);
  });

  it('should skip entries that are neither files nor directories', () => {
    const fifo = join(workDir, 'pipe');
    spawnSync('mkfifo', [fifo]);
    assert.deepEqual(discoverFiles(fifo), []);
  });

  it('should stop descending past the depth limit', () => {
    const file = writeFile(['deep.json']);
    assert.deepEqual(discoverFiles(file, 21), []);
    // The guard is inclusive: depth 20 is still allowed to recurse
    assert.deepEqual(discoverFiles(file, 20), [resolve(file)]);
  });
});

describe('parseJSON', () => {
  it('should parse a valid JSON file', () => {
    const file = writeFile(['valid.json'], JSON.stringify({ name: 'x', active: false }));
    const { data, error } = parseJSON(file);
    assert.deepEqual(data, { name: 'x', active: false });
    assert.equal(error, null);
  });

  it('should return a SCHEMA-01 error for malformed JSON', () => {
    const file = writeFile(['malformed.json'], '{ "name": ');
    const { data, error } = parseJSON(file);
    assert.equal(data, null);
    assert.equal(error.ruleId, 'SCHEMA-01');
    assert.equal(error.severity, 'error');
    assert.match(error.message, /Invalid JSON/);
    assert.equal(error.node, null);
  });

  it('should return a SCHEMA-01 error for unreadable files', () => {
    const { data, error } = parseJSON(join(workDir, 'gone.json'));
    assert.equal(data, null);
    assert.equal(error.ruleId, 'SCHEMA-01');
  });
});

describe('isN8nWorkflow', () => {
  it('should accept objects with a nodes array and a connections object', () => {
    assert.equal(isN8nWorkflow({ nodes: [], connections: {} }), true);
    assert.equal(isN8nWorkflow({ nodes: [{ name: 'A' }], connections: { A: {} } }), true);
  });

  it('should reject non-objects and non-arrays', () => {
    assert.equal(isN8nWorkflow(null), false);
    assert.equal(isN8nWorkflow('workflow'), false);
    assert.equal(isN8nWorkflow(undefined), false);
    assert.equal(isN8nWorkflow({ nodes: 'not-an-array', connections: {} }), false);
    assert.equal(isN8nWorkflow({ nodes: [] }), false);
  });
});
