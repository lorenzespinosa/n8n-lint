import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reportResults, reportJSON } from '../src/reporter.js';

const issue = (severity, overrides = {}) => ({
  ruleId: 'SCHEMA-02',
  severity,
  message: 'Missing required field: "name"',
  node: null,
  fix: null,
  ...overrides,
});

const captureLog = (fn) => {
  const original = console.log;
  const calls = [];
  console.log = (...args) => calls.push(args.join(''));
  try {
    const value = fn();
    return { calls, value };
  } finally {
    console.log = original;
  }
};

describe('reportResults', () => {
  it('should print a pass mark per clean file and a summary', () => {
    const { calls, value } = captureLog(() =>
      reportResults([{ file: 'clean.json', results: [], skipped: false }])
    );

    assert.ok(calls.some(l => l.includes('✓') && l.includes('clean.json')));
    const summary = calls[calls.length - 1];
    assert.match(summary, /1 file checked/);
    assert.match(summary, /0 issues/);
    assert.deepEqual(value, { totalErrors: 0, totalWarnings: 0, totalFiles: 1, skippedFiles: 0 });
  });

  it('should stay silent about clean files in quiet mode but still summarize', () => {
    const { calls } = captureLog(() =>
      reportResults([{ file: 'clean.json', results: [], skipped: false }], { quiet: true })
    );
    assert.ok(!calls.some(l => l.includes('✓')));
    assert.match(calls[calls.length - 1], /1 file checked · 0 issues/);
  });

  it('should print errors with the rule id, node and fix hint', () => {
    const { calls, value } = captureLog(() =>
      reportResults([
        {
          file: 'bad.json',
          results: [
            issue('error', {
              ruleId: 'SCHEMA-03',
              message: 'Node "Webhook" missing field: "id"',
              node: 'Webhook',
              fix: 'Add the missing field',
            }),
          ],
          skipped: false,
        },
      ])
    );

    const issueLine = calls.find(l => l.includes('[SCHEMA-03]'));
    assert.ok(issueLine, 'issue line should include the rule id');
    assert.ok(issueLine.includes('✗'));
    assert.ok(issueLine.includes('Node "Webhook" missing field: "id"'));
    assert.ok(issueLine.includes('(Webhook)'));
    const fixLine = calls.find(l => l.includes('Fix:'));
    assert.ok(fixLine.includes('Add the missing field'));
    assert.match(calls[calls.length - 1], /1 file checked · 1 error/);
    assert.equal(value.totalErrors, 1);
  });

  it('should print warnings with a warning icon', () => {
    const { calls, value } = captureLog(() =>
      reportResults([
        {
          file: 'warn.json',
          results: [issue('warning', { ruleId: 'SEC-03' })],
          skipped: false,
        },
      ])
    );
    const issueLine = calls.find(l => l.includes('[SEC-03]'));
    assert.ok(issueLine.includes('⚠'));
    assert.ok(!issueLine.includes('✗'));
    assert.match(calls[calls.length - 1], /1 file checked · 1 warning/);
    assert.equal(value.totalWarnings, 1);
  });

  it('should hide fix hints in quiet mode', () => {
    const { calls } = captureLog(() =>
      reportResults(
        [{ file: 'bad.json', results: [issue('error', { fix: 'Do something' })], skipped: false }],
        { quiet: true }
      )
    );
    assert.ok(!calls.some(l => l.includes('Fix:')));
    assert.ok(calls.some(l => l.includes('[SCHEMA-02]')), 'issues still print in quiet mode');
  });

  it('should omit the node suffix when a result has no node', () => {
    const { calls } = captureLog(() =>
      reportResults([{ file: 'bad.json', results: [issue('error')], skipped: false }])
    );
    const issueLine = calls.find(l => l.includes('[SCHEMA-02]'));
    assert.ok(!issueLine.includes('()'));
  });

  it('should pluralize files, errors and warnings', () => {
    const twoFiles = [
      { file: 'a.json', results: [issue('error')], skipped: false },
      {
        file: 'b.json',
        results: [issue('error'), issue('error'), issue('warning'), issue('warning')],
        skipped: false,
      },
    ];
    const { calls, value } = captureLog(() => reportResults(twoFiles));
    assert.match(calls[calls.length - 1], /2 files checked · 3 errors · 2 warnings/);
    assert.deepEqual(value, {
      totalErrors: 3,
      totalWarnings: 2,
      totalFiles: 2,
      skippedFiles: 0,
    });
  });

  it('should count skipped files separately and not check them', () => {
    const { calls, value } = captureLog(() =>
      reportResults([
        { file: 'package.json', results: [], skipped: true },
        { file: 'wf.json', results: [], skipped: false },
      ])
    );
    assert.ok(!calls.some(l => l.includes('package.json')), 'skipped files print nothing');
    assert.match(calls[calls.length - 1], /1 file checked · 0 issues · 1 skipped/);
    assert.equal(value.skippedFiles, 1);
    assert.equal(value.totalFiles, 1);
  });

  it('should summarize an empty run', () => {
    const { calls, value } = captureLog(() => reportResults([]));
    assert.match(calls[calls.length - 1], /0 files checked · 0 issues/);
    assert.deepEqual(value, { totalErrors: 0, totalWarnings: 0, totalFiles: 0, skippedFiles: 0 });
  });
});

describe('reportJSON', () => {
  it('should print a JSON array without skipped files', () => {
    const { calls, value } = captureLog(() =>
      reportJSON([
        {
          file: 'bad.json',
          results: [issue('error', { node: 'Webhook', fix: 'Add the field' })],
          skipped: false,
        },
        { file: 'package.json', results: [], skipped: true },
      ])
    );

    const printed = JSON.parse(calls.join('\n'));
    assert.equal(printed.length, 1);
    assert.equal(printed[0].file, 'bad.json');
    assert.deepEqual(printed[0].issues, [
      {
        ruleId: 'SCHEMA-02',
        severity: 'error',
        message: 'Missing required field: "name"',
        node: 'Webhook',
        fix: 'Add the field',
      },
    ]);
    assert.equal(value.totalErrors, 1);
  });

  it('should normalize missing fix values to null and count errors only', () => {
    const { calls, value } = captureLog(() =>
      reportJSON([
        {
          file: 'mixed.json',
          results: [issue('error'), issue('warning')],
          skipped: false,
        },
      ])
    );
    const printed = JSON.parse(calls.join('\n'));
    assert.equal(printed[0].issues.length, 2);
    assert.ok(printed[0].issues.every(i => i.fix === null));
    assert.equal(value.totalErrors, 1);
  });
});
