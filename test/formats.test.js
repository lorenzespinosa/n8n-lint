import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff } from '../src/diff.js';
import { reportHTML } from '../src/reporter.js';

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

describe('unifiedDiff', () => {
  it('should return an empty string for equivalent texts', () => {
    assert.equal(unifiedDiff('a\nb\nc\n', 'a\nb\nc\n'), '');
    // A trailing newline alone is not a difference worth a hunk
    assert.equal(unifiedDiff('a\nb\n', 'a\nb'), '');
  });

  it('should render a single line change with a correct hunk header', () => {
    const diff = unifiedDiff('a\nb\nc\n', 'a\nx\nc\n');
    assert.match(diff, /^--- original\n\+\+\+ fixed\n@@ -1,3 \+1,3 @@\n a\n-b\n\+x\n c\n$/);
  });

  it('should label headers with the provided file names', () => {
    const diff = unifiedDiff('a\n', 'b\n', { fromFile: 'old-wf.json', toFile: 'new-wf.json' });
    assert.ok(diff.startsWith('--- old-wf.json\n+++ new-wf.json\n'));
  });

  it('should render an insertion at the top of the file', () => {
    const diff = unifiedDiff('b\n', 'a\nb\n');
    assert.match(diff, /@@ -1,1 \+1,2 @@\n\+a\n b\n/);
  });

  it('should render a pure insertion into an empty original', () => {
    const diff = unifiedDiff('', 'a\n');
    assert.match(diff, /@@ -0,0 \+1,1 @@\n\+a\n/);
  });

  it('should split distant changes into separate hunks', () => {
    const oldText = Array.from({ length: 12 }, (_, i) => `line${i}`).join('\n') + '\n';
    const newText = oldText.replace('line0', 'ZERO').replace('line11', 'ELEVEN');
    const diff = unifiedDiff(oldText, newText);
    assert.equal(diff.match(/@@ -\d+,\d+ \+\d+,\d+ @@/g).length, 2, 'two hunks for two distant changes');
    assert.match(diff, /@@ -1,4 \+1,4 @@/);
    assert.match(diff, /@@ -9,4 \+9,4 @@/);
    assert.match(diff, /-line0\n\+ZERO/);
    assert.match(diff, /-line11\n\+ELEVEN/);
  });

  it('should keep nearby changes in one hunk', () => {
    const diff = unifiedDiff('a\nb\nc\nd\ne\n', 'a\nB\nc\nD\ne\n');
    assert.equal(diff.match(/@@ -\d+,\d+ \+\d+,\d+ @@/g).length, 1);
    assert.match(diff, /@@ -1,5 \+1,5 @@/);
    assert.match(diff, /-b\n\+B\n c\n-d\n\+D/);
  });
});

describe('reportHTML', () => {
  const issue = (severity, overrides = {}) => ({
    ruleId: 'SEC-01',
    severity,
    message: 'Possible leak',
    node: null,
    fix: null,
    ...overrides,
  });

  it('should print one self-contained document with a style block and no scripts', () => {
    const { calls, value } = captureLog(() =>
      reportHTML([{ file: 'wf.json', results: [issue('error')], skipped: false }])
    );

    assert.equal(calls.length, 1, 'the whole report is a single write');
    const html = calls[0];
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('<style>'));
    assert.ok(!/<script/i.test(html), 'no scripts');
    assert.ok(!/\ssrc=|\shref=/.test(html), 'no external resources');
    assert.ok(html.trimEnd().endsWith('</html>'));
    assert.deepEqual(value, { totalErrors: 1, totalWarnings: 0, totalFiles: 1, skippedFiles: 0 });
  });

  it('should summarize counts for errors, warnings, files and skipped files', () => {
    const { calls, value } = captureLog(() =>
      reportHTML([
        { file: 'a.json', results: [issue('error'), issue('warning')], skipped: false },
        { file: 'b.json', results: [issue('warning')], skipped: false },
        { file: 'c.json', results: [], skipped: false },
        { file: 'package.json', results: [], skipped: true },
      ])
    );

    const html = calls[0];
    assert.match(html, /3 files checked/);
    assert.match(html, /1 error/);
    assert.match(html, /2 warnings/);
    assert.match(html, /1 skipped \(not n8n workflows\)/);
    assert.ok(html.includes('c.json'), 'clean files are listed');
    assert.ok(!html.includes('package.json'), 'skipped files are excluded');
    assert.deepEqual(value, {
      totalErrors: 1,
      totalWarnings: 2,
      totalFiles: 3,
      skippedFiles: 1,
    });
  });

  it('should escape html-sensitive characters in file paths and findings', () => {
    const { calls } = captureLog(() =>
      reportHTML([
        {
          file: 'dir/file<1>&"2".json',
          results: [issue('error', {
            message: 'Token in node "<script>alert(\'x\')</script>"',
            node: '<b>bold</b>',
            fix: 'Say "hello" & remove',
          })],
          skipped: false,
        },
      ])
    );

    const html = calls[0];
    assert.ok(html.includes('file&lt;1&gt;&amp;&quot;2&quot;.json'));
    assert.ok(html.includes('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;'));
    assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
    assert.ok(html.includes('Say &quot;hello&quot; &amp; remove'));
    assert.ok(!html.includes('<script'), 'raw script tags never appear');
    assert.ok(!html.includes('<b>bold'), 'raw tags from findings never appear');
  });

  it('should mark severities so css can color them', () => {
    const { calls } = captureLog(() =>
      reportHTML([{ file: 'wf.json', results: [issue('error'), issue('warning')], skipped: false }])
    );
    const html = calls[0];
    assert.match(html, /<tr class="error">/);
    assert.match(html, /<tr class="warning">/);
  });

  it('should report a clean run without findings', () => {
    const { calls, value } = captureLog(() => reportHTML([]));
    const html = calls[0];
    assert.match(html, /0 files checked/);
    assert.match(html, /0 errors/);
    assert.match(html, /0 warnings/);
    assert.match(html, /No findings\./);
    assert.deepEqual(value, { totalErrors: 0, totalWarnings: 0, totalFiles: 0, skippedFiles: 0 });
  });
});
