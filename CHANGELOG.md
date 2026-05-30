# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
