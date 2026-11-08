#!/usr/bin/env node

import { Linter } from './linter.js';
import { discoverFiles } from './utils.js';
import { reportResults, reportJSON, reportHTML } from './reporter.js';
import { loadCliConfig, resolveRuleSettings, parseRuleFlag, ConfigError } from './config.js';
import { fixFile } from './fixer.js';

const args = process.argv.slice(2);

/** Output formats accepted by --format. text is the default. */
const FORMATS = ['text', 'json', 'html'];

// Parse flags
const flags = {
  quiet: args.includes('--quiet') || args.includes('-q'),
  fix: args.includes('--fix'),
  fixDryRun: args.includes('--fix-dry-run'),
  help: args.includes('--help') || args.includes('-h'),
  config: args.includes('--config') ? args[args.indexOf('--config') + 1] : null,
  printConfig: args.includes('--print-config'),
};

// Resolve --format <text|json|html>; a missing or unknown value is a usage error
let format = 'text';
if (args.includes('--format')) {
  const value = args[args.indexOf('--format') + 1];
  if (!value || value.startsWith('-')) {
    console.error(`Usage error: --format expects one of: ${FORMATS.join(', ')}`);
    process.exit(2);
  }
  if (!FORMATS.includes(value)) {
    console.error(`Usage error: unknown format ${JSON.stringify(value)}. Expected one of: ${FORMATS.join(', ')}`);
    process.exit(2);
  }
  format = value;
}

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

// Resolve --config <path>; a missing value is a usage error, not silent discovery
if (args.includes('--config')) {
  const value = args[args.indexOf('--config') + 1];
  if (!value || value.startsWith('-')) {
    console.error('Usage error: --config expects a file path');
    process.exit(2);
  }
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
  n8n-lint --format json workflows/
  n8n-lint --format html workflows/ > report.html
  n8n-lint --fix-dry-run workflows/
  n8n-lint --print-config
  n8n-lint --rule BP-05=error workflows/

Options:
  --quiet, -q          Show only errors
  --format <type>      Output format: text (default), json, or html
  --fix                Auto-fix safe issues (strip instanceId, set active:false)
  --fix-dry-run        Print a unified diff of what --fix would change; writes nothing
  --config <path>      Path to .n8nlintrc.json config file
  --rule <id>=<level>  Override one rule (repeatable), e.g. --rule BP-05=error
  --print-config       Print the resolved config as JSON and exit 0
  --help, -h           Show this help

Output formats:
  text   Colored terminal output with a summary line (default)
  json   Stable array: [{ file, issues: [{ ruleId, severity, message, node, fix }] }]
  html   One self-contained HTML report on stdout (inline CSS, no scripts)

Auto-fix:
  --fix is idempotent: a second run reports no changes and writes nothing.
  --fix-dry-run wins over --fix and "fix": true, so nothing is ever written.
  Files with unresolved merge conflict markers (<<<<<<<, =======, >>>>>>>)
  are refused in both modes.

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
  2  usage, config, or file errors (bad flags, invalid config, missing paths)

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

// Merge --fix flag (CLI flag overrides config); --fix-dry-run never writes
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

// Auto-fix pass (runs before lint so lint shows clean results). In dry-run
// mode the would-be changes are printed as a unified diff and nothing is
// written, so the lint report below reflects the files as they are.
// Fix diagnostics go to stderr under json/html so machine output stays parseable.
let hadFixError = false;
if (shouldFix || flags.fixDryRun) {
  const emit = format === 'text' ? console.log : console.error;
  for (const file of files) {
    const { fixed, changes, error, diff } = fixFile(file, { dryRun: flags.fixDryRun });
    if (error) {
      hadFixError = true;
      console.error(`Fix error (${file}): ${error}`);
    } else if (flags.fixDryRun) {
      if (diff) emit(diff.trimEnd());
    } else if (fixed && !flags.quiet) {
      emit(`Fixed: ${file}`);
      for (const change of changes) {
        emit(`  → ${change}`);
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
if (format === 'json') {
  ({ totalErrors } = reportJSON(allResults));
} else if (format === 'html') {
  ({ totalErrors } = reportHTML(allResults));
} else {
  ({ totalErrors } = reportResults(allResults, { quiet: flags.quiet }));
}

// Exit code: a failed fix pass is an operational (file) error and wins over
// finding counts, matching the documented exit-2 contract.
process.exit(hadFixError ? 2 : totalErrors > 0 ? 1 : 0);
