import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../src/linter.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = (...parts) => resolve(__dirname, 'fixtures', ...parts);

describe('Linter', () => {
  let linter;

  beforeEach(() => {
    linter = new Linter();
  });

  describe('constructor', () => {
    it('should load all rule sets', () => {
      assert.equal(linter.rules.length, 15);
      const ids = linter.rules.map(r => r.id);
      assert.ok(ids.includes('SCHEMA-02'));
      assert.ok(ids.includes('SEC-01'));
      assert.ok(ids.includes('BP-07'));
    });

    it('should default to no disabled rules and no severity overrides', () => {
      assert.equal(linter.disabledRules.size, 0);
      assert.equal(linter.severityOverrides.size, 0);
    });

    it('should accept disabled rules as an array', () => {
      const configured = new Linter({ disabledRules: ['BP-01', 'SEC-02'] });
      assert.equal(configured.disabledRules.size, 2);
      assert.ok(configured.disabledRules.has('BP-01'));
    });
  });

  describe('lint', () => {
    it('should return a SCHEMA-01 error for malformed JSON', () => {
      const result = linter.lint(fixtures('invalid', 'broken-json.json'));
      assert.equal(result.skipped, false);
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].ruleId, 'SCHEMA-01');
      assert.equal(result.results[0].severity, 'error');
      assert.ok(result.results[0].message.startsWith('Invalid JSON:'));
      assert.equal(result.results[0].node, null);
    });

    it('should skip JSON files that are not n8n workflows', () => {
      const result = linter.lint(fixtures('not-n8n', 'package.json'));
      assert.equal(result.skipped, true);
      assert.deepEqual(result.results, []);
    });

    it('should fall back to the rule severity when an issue has none', () => {
      const result = linter.lint(fixtures('invalid', 'missing-fields.json'));
      const schema02 = result.results.filter(r => r.ruleId === 'SCHEMA-02');
      assert.ok(schema02.length > 0);
      assert.ok(schema02.every(r => r.severity === 'error'));
    });

    it('should pass issue fix hints through', () => {
      const result = linter.lint(fixtures('invalid', 'active-true.json'));
      const bp01 = result.results.filter(r => r.ruleId === 'BP-01');
      assert.equal(bp01.length, 1);
      assert.match(bp01[0].fix, /Set "active" to false/);
    });

    it('should default node to null when a rule reports none', () => {
      const result = linter.lint(fixtures('invalid', 'large-workflow.json'));
      const bp06 = result.results.filter(r => r.ruleId === 'BP-06');
      assert.equal(bp06.length, 1);
      assert.equal(bp06[0].node, null);
      assert.equal(bp06[0].fix, null);
    });

    it('should not run rules disabled via the constructor', () => {
      const configured = new Linter({ disabledRules: ['BP-01', 'SEC-02'] });
      const result = configured.lint(fixtures('invalid', 'instance-id.json'));
      assert.deepEqual(result.results.filter(r => r.ruleId === 'SEC-02'), []);
    });

    it('should apply severity overrides over issue and rule severity', () => {
      const configured = new Linter({
        severityOverrides: new Map([['SEC-03', 'error'], ['BP-01', 'warning']]),
      });
      const sec03 = configured
        .lint(fixtures('invalid', 'root-id.json'))
        .results.filter(r => r.ruleId === 'SEC-03');
      assert.equal(sec03.length, 1);
      assert.equal(sec03[0].severity, 'error');

      const bp01 = configured
        .lint(fixtures('invalid', 'active-true.json'))
        .results.filter(r => r.ruleId === 'BP-01');
      assert.equal(bp01.length, 1);
      assert.equal(bp01[0].severity, 'warning');
    });

    it('should keep the issue severity when no override exists', () => {
      const result = linter.lint(fixtures('invalid', 'credential-name.json'));
      const sec05 = result.results.filter(r => r.ruleId === 'SEC-05');
      assert.equal(sec05.length, 1);
      assert.equal(sec05[0].severity, 'warning');
    });

    it('should report a crashed rule as an error instead of throwing', () => {
      linter.rules.push({
        id: 'TEST-CRASH',
        severity: 'warning',
        check() {
          throw new Error('boom');
        },
      });
      const result = linter.lint(fixtures('valid', 'simple-workflow.json'));
      const crash = result.results.filter(r => r.ruleId === 'TEST-CRASH');
      assert.equal(crash.length, 1);
      assert.equal(crash[0].severity, 'error');
      assert.match(crash[0].message, /Rule crashed: boom/);
      // Real rules still ran
      assert.equal(result.results.filter(r => r.ruleId === 'TEST-CRASH').length, 1);
    });

    it('should ignore rules whose check returns a non-array', () => {
      linter.rules.push({
        id: 'TEST-NONARRAY',
        severity: 'error',
        check() {
          return { not: 'an array' };
        },
      });
      const result = linter.lint(fixtures('valid', 'simple-workflow.json'));
      assert.deepEqual(result.results.filter(r => r.ruleId === 'TEST-NONARRAY'), []);
      assert.equal(result.results.length, 0);
    });

    it('should carry the file path through', () => {
      const file = fixtures('valid', 'simple-workflow.json');
      assert.equal(linter.lint(file).file, file);
    });
  });

  describe('lintFiles', () => {
    it('should lint every file and keep the input order', () => {
      const files = [
        fixtures('valid', 'simple-workflow.json'),
        fixtures('invalid', 'active-true.json'),
        fixtures('not-n8n', 'package.json'),
      ];
      const results = linter.lintFiles(files);
      assert.equal(results.length, 3);
      assert.deepEqual(results.map(r => r.file), files);
      assert.equal(results[1].results.some(r => r.ruleId === 'BP-01'), true);
      assert.equal(results[2].skipped, true);
    });

    it('should return an empty array for no files', () => {
      assert.deepEqual(linter.lintFiles([]), []);
    });
  });
});
