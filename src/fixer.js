import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { isN8nWorkflow } from './utils.js';
import { unifiedDiff } from './diff.js';

/**
 * Git and diff3 conflict markers, at line start: <<<<<<<, =======, >>>>>>>,
 * |||||||. Checked before parsing because a conflicted file is usually not
 * valid JSON anyway, and the marker message is the actionable one.
 */
const CONFLICT_MARKER_PATTERN = /^(?:<{7}|={7}|>{7}|\|{7})(?:[ \t].*)?$/m;

/**
 * True when the content contains unresolved merge conflict markers.
 */
export function hasConflictMarkers(content) {
  return CONFLICT_MARKER_PATTERN.test(content);
}

/**
 * Apply safe auto-fixes to a workflow JSON file.
 * Currently supports:
 * - Strip meta.instanceId (SEC-02)
 * - Strip root-level id (SEC-03)
 * - Set active: false (BP-01)
 *
 * With { dryRun: true } nothing is written; instead the return value
 * carries a unified diff of the changes that --fix would apply. Fixes are
 * idempotent by construction: every fix removes the condition that
 * triggered it, so a second run reports no changes and writes nothing.
 *
 * Files containing unresolved merge conflict markers are refused (error)
 * in both modes; auto-rewriting a conflicted file could silently discard
 * one side of the merge.
 */
export function fixFile(filePath, { dryRun = false } = {}) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { fixed: false, changes: [], error: `Cannot read file: ${err.message}`, diff: null };
  }

  if (hasConflictMarkers(content)) {
    return {
      fixed: false,
      changes: [],
      error: 'Unresolved merge conflict markers; resolve the conflict before fixing',
      diff: null,
    };
  }

  let data;
  try {
    data = JSON.parse(content);
  } catch {
    return { fixed: false, changes: [], error: 'Invalid JSON', diff: null };
  }

  // MEDIUM-4 fix: Skip non-n8n JSON files (prevents corrupting package.json etc.)
  if (!isN8nWorkflow(data)) {
    return { fixed: false, changes: [], error: null, diff: null };
  }

  const changes = [];

  // SEC-02: Strip meta.instanceId
  if (data.meta?.instanceId) {
    delete data.meta.instanceId;
    if (data.meta && Object.keys(data.meta).length === 0) {
      delete data.meta;
    }
    changes.push('Removed meta.instanceId');
  }

  // SEC-03: Strip root-level id
  if ('id' in data && typeof data.id === 'string') {
    delete data.id;
    changes.push('Removed root-level id');
  }

  // BP-01: Set active to false
  if (data.active === true) {
    data.active = false;
    changes.push('Set active: false');
  }

  // Like earlier releases, the no-change and success results carry no
  // `error` key; only failure and skip paths set it.
  if (changes.length === 0) {
    return { fixed: false, changes, diff: null };
  }

  const fixedContent = JSON.stringify(data, null, 2) + '\n';

  if (dryRun) {
    return {
      fixed: false,
      changes,
      diff: unifiedDiff(content, fixedContent, { fromFile: filePath, toFile: filePath }),
    };
  }

  // HIGH-3 fix: Atomic write via temp file + rename (prevents data loss on interrupted write)
  try {
    const tmpPath = join(tmpdir(), `n8n-lint-${basename(filePath)}-${Date.now()}.tmp`);
    writeFileSync(tmpPath, fixedContent, 'utf-8');
    renameSync(tmpPath, filePath);
  } catch (err) {
    return { fixed: false, changes: [], error: `Cannot write file: ${err.message}`, diff: null };
  }

  return { fixed: true, changes, diff: null };
}
