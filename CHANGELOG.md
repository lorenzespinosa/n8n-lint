# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-11-07

### Added
- `.n8nlintrc.json` discovery from the current working directory upward; the nearest file wins, and `--config PATH` still pins an exact file
- Profiles as rule packs: `default` (built-in severities), `strict` (every rule an error, including rules that normally warn), and `security` (only security rules, all errors). Multiple profiles compose in the order listed
- `--print-config`: prints the resolved config (discovered file + profiles + CLI overrides) as JSON and exits 0, for CI-friendly debugging
- `--rule <id>=<off|warn|error>`: repeatable CLI rule override that wins over any config file entry
- Strict config validation with clear `Config error:` messages and exit code 2: unknown rule ids, bad severity values, unknown profile names, unknown top-level keys, non-object roots, and invalid JSON
- Central rule catalog in `src/rules/index.js`, shared by the linter, config validation, and profiles, so new rules join the packs automatically

### Changed
- Rule severity precedence is now explicit: built-in severities, then profiles, then `rules` entries from the config file, then `--rule` flags
- Exit code 2 now covers config errors as well as usage errors; findings still exit 1 purely by severity
- Test count: 168 to 231 (config discovery, validation, profile composition, CLI precedence, and print-config coverage)

### Fixed
- `npm test` only executed `test/rules/linter.test.js` because the `test/**/*.test.js` glob does not expand recursively in plain `sh`; the script now discovers every test file under `test/`

### Breaking
- Severity values in config files must now be exactly `"off"`, `"warn"`, or `"error"`. The legacy `"warning"` and `false` values are rejected with exit code 2
- Unknown top-level config keys are rejected instead of silently ignored
- `SCHEMA-01` (JSON syntax) cannot be disabled or re-leveled, since parsing happens before rule evaluation; configuring it is a config error

## [1.3.0] - 2025-08-12

### Added
- GitHub Actions CI workflow (`npm ci` + `npm test` on a Node 18 + 20 matrix) on push/PR to `main`
- Dedicated test coverage for the 6 previously-untested rules: SCHEMA-03, SEC-03, SEC-04, SEC-05, BP-06, BP-07 (every rule now has a focused test)
- New fixtures: `node-missing-fields`, `root-id`, `url-token`, `credential-name`, `large-workflow`, `infinite-loop`
- `examples/` directory with a clean workflow and an intentionally-flawed workflow demonstrating the linter
- CI status badge in the README

### Changed
- Test count: 13 → 21
- Synced `package.json` version with the changelog history
- Corrected the README sample output to match real linter formatting

## [1.2.0] - 2025-07-01

### Added
- README with comprehensive rule reference, CI examples, architecture diagram
- CONTRIBUTING.md with rule development guide
- Related projects section linking to n8n template repos
- Issue templates (bug report + rule request)

## [1.1.0] - 2025-05-20

### Added
- `.n8nlintrc.json` config file support (enable/disable/override severity per rule)
- `--fix` flag: auto-strips meta.instanceId, root-level id, sets active:false
- `--format json`: machine-readable JSON output for CI pipelines
- `--quiet` / `-q`: show only errors
- `--config <path>`: custom config file path
- BP-05: HTTP Request nodes without error handling detection
- BP-06: Large workflow detection (>50 nodes)
- BP-07: Infinite loop risk detection (cycle DFS with termination condition check)

### Changed
- Rule count: 13 → 16
- Test count: 11 → 13

## [1.0.0] - 2025-04-15

### Added
- Core linting engine with 13 rules
- Schema rules: SCHEMA-01 (JSON syntax), SCHEMA-02 (required fields), SCHEMA-03 (node fields), SCHEMA-04 (orphaned connections)
- Security rules: SEC-01 (credential leaks), SEC-02 (instanceId), SEC-03 (root id), SEC-04 (URL tokens), SEC-05 (credential names)
- Best practice rules: BP-01 (active flag), BP-02 (deprecated nodes), BP-03 (orphaned nodes), BP-04 (duplicate names)
- Colored terminal output with per-file results
- Summary line (files checked, errors, warnings)
- Exit code 1 on errors for CI integration
- Test suite with fixtures for every rule
