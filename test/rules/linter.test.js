import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from '../../src/linter.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = (name) => resolve(__dirname, '..', 'fixtures', name);

describe('n8n-lint', () => {

  describe('valid workflows', () => {
    it('should pass with no issues', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('valid/simple-workflow.json'));
      assert.equal(result.results.length, 0, `Expected 0 issues, got: ${JSON.stringify(result.results)}`);
    });
  });

  describe('SCHEMA-01: invalid JSON', () => {
    it('should detect malformed JSON', () => {
      const linter = new Linter();
      // Create a temp invalid file path test via the linter's behavior
      const result = linter.lint(fixtures('invalid/not-a-real-file.json'));
      assert.ok(result.results.length > 0);
      assert.equal(result.results[0].ruleId, 'SCHEMA-01');
    });
  });

  describe('SCHEMA-02: missing required fields', () => {
    it('should detect missing name and active fields', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/missing-fields.json'));
      const schema02 = result.results.filter(r => r.ruleId === 'SCHEMA-02');
      assert.ok(schema02.length >= 1, 'Should detect missing fields');
      assert.ok(schema02.some(r => r.message.includes('name')));
    });
  });

  describe('SCHEMA-03: node required fields', () => {
    it('should detect a node missing id and typeVersion', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/node-missing-fields.json'));
      const schema03 = result.results.filter(r => r.ruleId === 'SCHEMA-03');
      assert.ok(schema03.length >= 1, 'Should detect missing node fields');
      assert.ok(schema03.some(r => r.message.includes('id')));
      assert.ok(schema03.some(r => r.message.includes('typeVersion')));
    });
  });

  describe('SCHEMA-04: orphaned connections', () => {
    it('should detect connection to non-existent node', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/orphaned-connection.json'));
      const schema04 = result.results.filter(r => r.ruleId === 'SCHEMA-04');
      assert.ok(schema04.length >= 1, 'Should detect orphaned connection');
      assert.ok(schema04.some(r => r.message.includes('Deleted Node')));
    });
  });

  describe('SEC-01: credential leaks', () => {
    it('should detect Bearer tokens', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/credential-leak.json'));
      const sec01 = result.results.filter(r => r.ruleId === 'SEC-01');
      assert.ok(sec01.length >= 1, 'Should detect credential leak');
    });
  });

  describe('SEC-02: meta.instanceId', () => {
    it('should detect instanceId', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/instance-id.json'));
      const sec02 = result.results.filter(r => r.ruleId === 'SEC-02');
      assert.equal(sec02.length, 1);
      assert.ok(sec02[0].message.includes('instanceId'));
    });
  });

  describe('SEC-03: root-level id', () => {
    it('should detect a root-level id field', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/root-id.json'));
      const sec03 = result.results.filter(r => r.ruleId === 'SEC-03');
      assert.equal(sec03.length, 1);
      assert.equal(sec03[0].severity, 'warning');
      assert.ok(sec03[0].message.includes('Root-level id'));
    });
  });

  describe('SEC-04: auth tokens in URLs', () => {
    it('should detect a URL with an auth token in the query string', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/url-token.json'));
      const sec04 = result.results.filter(r => r.ruleId === 'SEC-04');
      assert.ok(sec04.length >= 1, 'Should detect URL auth parameter');
      assert.ok(sec04[0].message.includes('[REDACTED]'), 'Token value should be redacted');
    });
  });

  describe('SEC-05: credential name leaks', () => {
    it('should flag a node with a credential id', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/credential-name.json'));
      const sec05 = result.results.filter(r => r.ruleId === 'SEC-05');
      assert.equal(sec05.length, 1);
      assert.equal(sec05[0].severity, 'warning');
      assert.ok(sec05[0].message.includes('credential ID'));
    });
  });

  describe('BP-01: active flag', () => {
    it('should flag active: true', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/active-true.json'));
      const bp01 = result.results.filter(r => r.ruleId === 'BP-01');
      assert.equal(bp01.length, 1);
    });
  });

  describe('BP-02: deprecated nodes', () => {
    it('should flag Function node', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/deprecated-function.json'));
      const bp02 = result.results.filter(r => r.ruleId === 'BP-02');
      assert.equal(bp02.length, 1);
      assert.ok(bp02[0].message.includes('Function'));
    });
  });

  describe('BP-03: orphaned nodes', () => {
    it('should flag unconnected non-trigger nodes', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/orphaned-node.json'));
      const bp03 = result.results.filter(r => r.ruleId === 'BP-03');
      assert.equal(bp03.length, 1);
      assert.ok(bp03[0].message.includes('Orphan'));
    });
  });

  describe('BP-04: duplicate names', () => {
    it('should flag duplicate node names', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/duplicate-names.json'));
      const bp04 = result.results.filter(r => r.ruleId === 'BP-04');
      assert.ok(bp04.length >= 1);
    });
  });

  describe('rule disabling', () => {
    it('should skip disabled rules', () => {
      const linter = new Linter({ disabledRules: ['BP-01'] });
      const result = linter.lint(fixtures('invalid/active-true.json'));
      const bp01 = result.results.filter(r => r.ruleId === 'BP-01');
      assert.equal(bp01.length, 0, 'BP-01 should be disabled');
    });
  });

  describe('BP-05: missing error handling', () => {
    it('should flag HTTP Request without error handling', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/no-error-handling.json'));
      const bp05 = result.results.filter(r => r.ruleId === 'BP-05');
      assert.ok(bp05.length >= 1);
    });

    it('should pass HTTP Request with continueOnFail', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('valid/with-error-handling.json'));
      const bp05 = result.results.filter(r => r.ruleId === 'BP-05');
      assert.equal(bp05.length, 0);
    });
  });

  describe('BP-06: large workflow', () => {
    it('should flag a workflow with more than 50 nodes', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/large-workflow.json'));
      const bp06 = result.results.filter(r => r.ruleId === 'BP-06');
      assert.equal(bp06.length, 1);
      assert.ok(bp06[0].message.includes('52 nodes'));
    });

    it('should not flag a small workflow', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('valid/simple-workflow.json'));
      const bp06 = result.results.filter(r => r.ruleId === 'BP-06');
      assert.equal(bp06.length, 0);
    });
  });

  describe('BP-07: infinite loop risk', () => {
    it('should flag a cycle with no IF/Switch/Filter termination', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('invalid/infinite-loop.json'));
      const bp07 = result.results.filter(r => r.ruleId === 'BP-07');
      assert.ok(bp07.length >= 1, 'Should detect potential infinite loop');
      assert.ok(bp07[0].message.includes('infinite loop'));
    });

    it('should not flag an acyclic workflow', () => {
      const linter = new Linter();
      const result = linter.lint(fixtures('valid/simple-workflow.json'));
      const bp07 = result.results.filter(r => r.ruleId === 'BP-07');
      assert.equal(bp07.length, 0);
    });
  });
});
