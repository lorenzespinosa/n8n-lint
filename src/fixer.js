import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { isN8nWorkflow } from './utils.js';

/**
 * Apply safe auto-fixes to a workflow JSON file.
 * Currently supports:
 * - Strip meta.instanceId (SEC-02)
 * - Strip root-level id (SEC-03)
 * - Set active: false (BP-01)
 */
export function fixFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { fixed: false, changes: [], error: `Cannot read file: ${err.message}` };
  }
  let data;

  try {
    data = JSON.parse(content);
  } catch {
    return { fixed: false, changes: [], error: 'Invalid JSON' };
  }

  // MEDIUM-4 fix: Skip non-n8n JSON files (prevents corrupting package.json etc.)
  if (!isN8nWorkflow(data)) {
    return { fixed: false, changes: [], error: null };
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

  // HIGH-3 fix: Atomic write via temp file + rename (prevents data loss on interrupted write)
  if (changes.length > 0) {
    try {
      const tmpPath = join(tmpdir(), `n8n-lint-${basename(filePath)}-${Date.now()}.tmp`);
      writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      renameSync(tmpPath, filePath);
    } catch (err) {
      return { fixed: false, changes: [], error: `Cannot write file: ${err.message}` };
    }
  }

  return { fixed: changes.length > 0, changes };
}
