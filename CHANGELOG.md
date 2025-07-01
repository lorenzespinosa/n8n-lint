# Changelog

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
