/**
 * Minimal unified diff generator for --fix-dry-run.
 *
 * Produces a standard unified diff (--- / +++ headers, @@ hunks, ' ', '-'
 * and '+' prefixed lines) from two strings, with no external dependencies.
 * Workflow JSON files are small, so a classic LCS dynamic program is fast
 * enough; oversized inputs fall back to a single whole-file replacement
 * hunk, which is still a valid unified diff.
 */

const MAX_LINES = 4000;

/**
 * Split text into lines. A trailing newline does not create a final empty
 * line, so "a\n" and "a" compare equal. The fixer always writes a trailing
 * newline, and that difference alone is not worth a hunk.
 */
function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Compute the edit script that turns `a` into `b` as a list of
 * { type: 'equal' | 'delete' | 'add', line } operations.
 */
function buildOps(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // dp[i * width + j] = LCS length of a[i..] and b[j..]
  const dp = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', line: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ type: 'delete', line: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'delete', line: a[i++] });
  while (j < m) ops.push({ type: 'add', line: b[j++] });
  return ops;
}

/** Fallback edit script for oversized inputs: replace everything. */
function buildReplaceOps(a, b) {
  return [
    ...a.map(line => ({ type: 'delete', line })),
    ...b.map(line => ({ type: 'add', line })),
  ];
}

/**
 * Group changed op indices into hunks with `context` equal lines around
 * each change, merging regions whose gap is entirely context.
 */
function buildHunks(ops, context) {
  const changed = [];
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type !== 'equal') changed.push(idx);
  }
  if (changed.length === 0) return [];

  // Merge change indices whose gap fits within 2 * context equal lines.
  const regions = [];
  let start = changed[0];
  let end = changed[0];
  for (const idx of changed.slice(1)) {
    if (idx - end - 1 <= 2 * context) {
      end = idx;
    } else {
      regions.push([start, end]);
      start = idx;
      end = idx;
    }
  }
  regions.push([start, end]);

  const hunks = [];
  for (const [regionStart, regionEnd] of regions) {
    const lo = Math.max(0, regionStart - context);
    const hi = Math.min(ops.length, regionEnd + context + 1);
    const slice = ops.slice(lo, hi);

    let oldBefore = 0;
    let newBefore = 0;
    for (let idx = 0; idx < lo; idx++) {
      if (ops[idx].type !== 'add') oldBefore++;
      if (ops[idx].type !== 'delete') newBefore++;
    }

    let oldCount = 0;
    let newCount = 0;
    const body = [];
    for (const op of slice) {
      if (op.type !== 'add') oldCount++;
      if (op.type !== 'delete') newCount++;
      body.push(`${op.type === 'equal' ? ' ' : op.type === 'delete' ? '-' : '+'}${op.line}`);
    }

    // Unified diff convention: an empty side points at the line before
    // the hunk rather than the line after it.
    const oldStart = oldCount === 0 ? oldBefore : oldBefore + 1;
    const newStart = newCount === 0 ? newBefore : newBefore + 1;

    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${body.join('\n')}`);
  }
  return hunks;
}

/**
 * Render a unified diff between two strings. Returns '' when the texts are
 * equivalent. `fromFile` and `toFile` label the --- and +++ header lines.
 */
export function unifiedDiff(oldText, newText, { fromFile = 'original', toFile = 'fixed', context = 3 } = {}) {
  const a = splitLines(String(oldText));
  const b = splitLines(String(newText));

  const ops = a.length <= MAX_LINES && b.length <= MAX_LINES
    ? buildOps(a, b)
    : buildReplaceOps(a, b);
  if (ops.every(op => op.type === 'equal')) return '';

  const hunks = buildHunks(ops, context);
  if (hunks.length === 0) return '';
  return [`--- ${fromFile}`, `+++ ${toFile}`, ...hunks].join('\n') + '\n';
}
