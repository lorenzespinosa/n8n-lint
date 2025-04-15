import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

/**
 * Recursively discover all .json files from a path argument.
 * If path is a file, return [path]. If directory, recurse.
 * Skips node_modules, .git, and hidden directories.
 */
export function discoverFiles(pathArg) {
  const resolved = resolve(pathArg);
  const stat = statSync(resolved, { throwIfNoEntry: false });

  if (!stat) {
    throw new Error(`Path not found: ${pathArg}`);
  }

  if (stat.isFile()) {
    return extname(resolved) === '.json' ? [resolved] : [];
  }

  if (stat.isDirectory()) {
    const results = [];
    const entries = readdirSync(resolved);

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const fullPath = resolve(resolved, entry);
      results.push(...discoverFiles(fullPath));
    }

    return results;
  }

  return [];
}

/**
 * Parse a JSON file and return the parsed object.
 * Returns { data, error } — error is a SCHEMA-01 result if parse fails.
 */
export function parseJSON(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: {
        ruleId: 'SCHEMA-01',
        severity: 'error',
        message: `Invalid JSON: ${err.message}`,
        node: null,
      },
    };
  }
}

/**
 * Check if a JSON object looks like an n8n workflow.
 * Must have at least 'nodes' and 'connections' fields.
 */
export function isN8nWorkflow(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    Array.isArray(data.nodes) &&
    typeof data.connections === 'object'
  );
}
