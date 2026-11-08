#!/usr/bin/env node

import { Linter } from './linter.js';
import { discoverFiles } from './utils.js';
import { reportResults, reportJSON } from './reporter.js';
import { loadCliConfig, resolveRuleSettings, parseRuleFlag, ConfigError } from './config.js';
import { fixFile } from './fixer.js';

const args = process.argv.slice(2);

// Parse flags
const flags = {
  quiet: args.includes('--quiet') || args.includes('-q'),
  json: args.includes('--format') && args[args.indexOf('--format') + 1] === 'json',
  fix: args.includes('--fix'),
  help: args.includes('--help') || args.includes('-h'),
  config: args.includes('--config') ? args[args.indexOf('--config') + 1] : null,
  printConfig: args.includes('--print-config'),
};

// Collect repeatable --rule values (validated after the help branch)
const ruleFlagValues = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--rule') continue;
  const value = args[i + 1];
  if (!value || value.startsWith('-')) {
    console.error('Config error: --rule expects a value like BP-05=error');
    process.exit(2);
  }
  ruleFlagValues.push(value);
}

// Remove flags from args to get paths
const flagsWithValues = new Set(['--format', '--config', '--rule']);
const paths = args.filter((a, i) => {
  if (a.startsWith('--') || a.startsWith('-')) return false;
  // Skip values that follow flags expecting a value
  if (i > 0 && flagsWithValues.has(args[i - 1])) return false;
  return true;
});

if (flags.help || (paths.length === 0 && !flags.printConfig)) {
  console.log(`
n8n-lint - Validate n8n workflow JSON files

Usage:
  n8n-lint <file-or-directory> [options]

Examples:
  n8n-lint workflows/my-workflow.json
  n8n-lint workflows/
  n8n-lint .
  n8n-lint --print-config
  n8n-lint --rule BP-05=error workflows/

Options:
  --quiet, -q          Show only errors
  --format json        Output results as JSON
  --fix                Auto-fix safe issues (strip instanceId, set active:false)
  --config <path>      Path to .n8nlintrc.json config file
  --rule <id>=<level>  Override one rule (repeatable), e.g. --rule BP-05=error
  --print-config       Print the resolved config as JSON and exit 0
  --help, -h           Show this help

Config (.n8nlintrc.json), discovered from the current directory upward:
  {
    "profiles": ["strict"],
    "rules": {
      "BP-01": "off",       // disable rule
      "SEC-02": "warn",     // override severity
      "BP-05": "error"      // override severity
    },
    "fix": false
  }

Profiles:
  default   Built-in severities for every rule
  strict    Every rule is reported as an error
  security  Only security rules, all as errors

Precedence: built-in severities < profiles < rules entries < --rule flags.
Invalid configs (unknown rule ids, bad severity values, unknown profiles)
fail with exit code 2.

Exit codes:
  0  no errors (warnings do not fail the run)
  1  one or more error-severity findings
  2  config, argument, or file discovery errors

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
  BP-05      HTTP Request without error handling
  BP-06      Large workflow (>50 nodes)
  BP-07      Infinite loop risk
`);
  process.exit(0);
}

// Load config: explicit --config path, else nearest .n8nlintrc.json upward
let configFile;
let config;
let cliRules;
try {
  ({ configFile, config } = loadCliConfig(flags.config));
  cliRules = ruleFlagValues.map(parseRuleFlag);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(`Config error: ${err.message}`);
  process.exit(2);
}

// Resolve built-in severities < profiles < rules < --rule flags
const resolved = resolveRuleSettings({
  profiles: config.profiles,
  rules: config.rules,
  cliRules,
});

// --print-config: dump the effective config for CI debugging and stop
if (flags.printConfig) {
  console.log(JSON.stringify({
    configFile,
    profiles: config.profiles,
    fix: flags.fix || config.fix,
    rules: resolved.rules,
  }, null, 2));
  process.exit(0);
}

// Merge --fix flag (CLI flag overrides config)
const shouldFix = flags.fix || config.fix;

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

// Auto-fix pass (runs before lint so lint shows clean results)
if (shouldFix) {
  for (const file of files) {
    const { fixed, changes, error } = fixFile(file);
    if (error) {
      console.error(`Fix error (${file}): ${error}`);
    } else if (fixed && !flags.quiet) {
      console.log(`Fixed: ${file}`);
      for (const change of changes) {
        console.log(`  → ${change}`);
      }
    }
  }
}

// Lint
const linter = new Linter({
  disabledRules: [...resolved.disabledRules],
  severityOverrides: resolved.severityOverrides,
});
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
