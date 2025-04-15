# Contributing to n8n-lint

Thanks for your interest in improving n8n-lint. This guide covers adding new lint rules, running the test suite, and submitting pull requests.

## Development Setup

```bash
git clone https://github.com/example/n8n-lint.git
cd n8n-lint
npm install
npm test
```

## Adding a New Rule

### 1. Create the rule file

Rules live in `src/rules/<category>/` where category is one of:
- `schema/` -- structural JSON validation
- `security/` -- credential leaks, identity exposure
- `best-practices/` -- workflow hygiene and standards

Create a new file following the naming convention `<rule-id>.js`:

```javascript
// src/rules/best-practices/bp-05.js

export default {
  id: 'BP-05',
  severity: 'warning',          // 'error' or 'warning'
  description: 'Short description of what this rule detects',

  /**
   * @param {object} workflow - Parsed workflow JSON
   * @returns {Array<{ruleId: string, severity: string, message: string, node?: string}>}
   */
  check(workflow) {
    const issues = [];

    // Your detection logic here
    for (const node of workflow.nodes || []) {
      if (/* condition */) {
        issues.push({
          ruleId: this.id,
          severity: this.severity,
          message: `Description of the problem in node "${node.name}"`,
          node: node.name,
        });
      }
    }

    return issues;
  },
};
```

### 2. Register the rule

Add your rule to the category's index file:

```javascript
// src/rules/best-practices/index.js
export { default as bp05 } from './bp-05.js';
```

The linter auto-discovers all exported rules from category index files.

### 3. Add test fixtures

Create a workflow JSON file that triggers the rule:

```
test/fixtures/invalid/<descriptive-name>.json
```

The fixture should be a minimal n8n workflow that contains exactly the pattern your rule detects. Keep it small -- only include the nodes/fields needed to trigger the violation.

### 4. Add test cases

Add a `describe` block to `test/rules/linter.test.js`:

```javascript
describe('BP-05: your rule name', () => {
  it('should detect the violation', () => {
    const linter = new Linter();
    const result = linter.lint(fixtures('invalid/your-fixture.json'));
    const bp05 = result.results.filter(r => r.ruleId === 'BP-05');
    assert.equal(bp05.length, 1);
    assert.ok(bp05[0].message.includes('expected keyword'));
  });
});
```

Also verify the valid fixture still passes:

```javascript
it('should not flag valid workflows', () => {
  const linter = new Linter();
  const result = linter.lint(fixtures('valid/simple-workflow.json'));
  const bp05 = result.results.filter(r => r.ruleId === 'BP-05');
  assert.equal(bp05.length, 0);
});
```

### 5. Run tests

```bash
npm test
```

All existing tests must continue to pass.

## Rule Design Guidelines

- **One concern per rule.** Each rule should check exactly one thing.
- **Actionable messages.** Tell the user what's wrong and ideally how to fix it.
- **Include the node name** in the message when applicable.
- **Use `error` severity** only for things that would cause runtime failures or security issues.
- **Use `warning` severity** for best-practice violations and hygiene issues.

## PR Checklist

Before submitting your pull request, verify:

- [ ] Rule file created in the correct category directory
- [ ] Rule registered in the category index
- [ ] Test fixture(s) added to `test/fixtures/invalid/`
- [ ] Test cases added to `test/rules/linter.test.js`
- [ ] `npm test` passes with no failures
- [ ] Rule ID follows the naming convention (`SCHEMA-XX`, `SEC-XX`, `BP-XX`)
- [ ] Rule description is clear and concise
- [ ] CHANGELOG.md updated with the new rule

## Code Style

- Pure ESM (no CommonJS)
- Node.js built-in test runner (`node:test`)
- No external runtime dependencies
- Consistent use of `node:assert/strict` in tests

## Questions?

Open an issue with the `question` label.
