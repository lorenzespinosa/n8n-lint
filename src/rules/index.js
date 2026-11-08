/**
 * Central rule registry.
 *
 * The default export is the list of checkable rules (the ones the Linter
 * executes), in evaluation order. `ruleCatalog` additionally lists SCHEMA-01
 * so config files and --print-config can talk about every rule id that the
 * docs mention. SCHEMA-01 has no check(): JSON parsing happens before rule
 * evaluation, so it always runs and cannot be disabled.
 */
import schemaRules from './schema/index.js';
import securityRules from './security/index.js';
import bestPracticeRules from './best-practices/index.js';

export const ruleCategories = [
  { name: 'schema', rules: schemaRules },
  { name: 'security', rules: securityRules },
  { name: 'best-practices', rules: bestPracticeRules },
];

const checkableRules = [...schemaRules, ...securityRules, ...bestPracticeRules];

export default checkableRules;

const categoryByRuleId = new Map();
for (const { name, rules } of ruleCategories) {
  for (const rule of rules) categoryByRuleId.set(rule.id, name);
}

export const ruleCatalog = [
  {
    id: 'SCHEMA-01',
    severity: 'error',
    category: 'schema',
    description: 'Valid JSON syntax',
  },
  ...checkableRules.map(rule => ({
    id: rule.id,
    severity: rule.severity,
    category: categoryByRuleId.get(rule.id),
    description: rule.description,
  })),
];
