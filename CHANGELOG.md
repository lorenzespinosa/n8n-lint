# Changelog

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
