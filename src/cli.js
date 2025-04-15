#!/usr/bin/env node

import { Linter } from './linter.js';
import { discoverFiles } from './utils.js';
import { reportResults, reportJSON } from './reporter.js';

const args = process.argv.slice(2);

// Parse flags
const flags = {
  quiet: args.includes('--quiet') || args.includes('-q'),
  json: args.includes('--format') && args[args.indexOf('--format') + 1] === 'json',
  fix: args.includes('--fix'),
  help: args.includes('--help') || args.includes('-h'),
};

// Remove flags from args to get paths
const paths = args.filter(a => !a.startsWith('--') && !a.startsWith('-') && a !== 'json');

if (flags.help || paths.length === 0) {
  console.log(`
n8n-lint — Validate n8n workflow JSON files

Usage:
  n8n-lint <file-or-directory> [options]

Examples:
  n8n-lint workflows/my-workflow.json
  n8n-lint workflows/
  n8n-lint .

Options:
  --quiet, -q       Show only errors
  --format json     Output results as JSON
  --fix             Auto-fix safe issues (strip instanceId, set active:false)
  --help, -h        Show this help

Rules:
  SCHEMA-01  Valid JSON syntax
  SCHEMA-02  Required top-level fields
  SCHEMA-03  Node required fields
  SCHEMA-04  Orphaned connections
  SEC-01     Credential leaks
  SEC-02     meta.instanceId present
  SEC-03     Root-level id present
  SEC-04     Auth tokens in URLs
  SEC-05     Credential name leaks
  BP-01      active: true (should be false)
  BP-02      Deprecated Function node
  BP-03      Orphaned/unconnected nodes
  BP-04      Duplicate node names
`);
  process.exit(0);
}

// Discover files
let files = [];
for (const p of paths) {
  try {
    files.push(...discoverFiles(p));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }
}

if (files.length === 0) {
  console.error('No JSON files found');
  process.exit(2);
}

// Lint
const linter = new Linter();
const allResults = linter.lintFiles(files);

// Report
let totalErrors;
if (flags.json) {
  ({ totalErrors } = reportJSON(allResults));
} else {
  ({ totalErrors } = reportResults(allResults, { quiet: flags.quiet }));
}

// Exit code
process.exit(totalErrors > 0 ? 1 : 0);
