import { parseJSON, isN8nWorkflow } from './utils.js';
import schemaRules from './rules/schema/index.js';
import securityRules from './rules/security/index.js';
import bestPracticeRules from './rules/best-practices/index.js';

export class Linter {
  constructor(options = {}) {
    this.rules = [...schemaRules, ...securityRules, ...bestPracticeRules];
    this.disabledRules = new Set(options.disabledRules || []);
    this.severityOverrides = options.severityOverrides || new Map();
  }

  /**
   * Lint a single file. Returns { file, results, skipped }.
   * results is an array of { ruleId, severity, message, node }.
   */
  lint(filePath) {
    const { data, error } = parseJSON(filePath);

    // SCHEMA-01: JSON parse failure
    if (error) {
      return { file: filePath, results: [error], skipped: false };
    }

    // Skip non-n8n JSON files (like package.json)
    if (!isN8nWorkflow(data)) {
      return { file: filePath, results: [], skipped: true };
    }

    const results = [];

    for (const rule of this.rules) {
      if (this.disabledRules.has(rule.id)) continue;

      try {
        const issues = rule.check(data);
        if (Array.isArray(issues)) {
          results.push(...issues.map(issue => ({
            ruleId: rule.id,
            severity: this.severityOverrides.get(rule.id) || issue.severity || rule.severity,
            message: issue.message,
            node: issue.node || null,
            fix: issue.fix || null,
          })));
        }
      } catch (err) {
        results.push({
          ruleId: rule.id,
          severity: 'error',
          message: `Rule crashed: ${err.message}`,
          node: null,
        });
      }
    }

    return { file: filePath, results, skipped: false };
  }

  /**
   * Lint multiple files. Returns array of lint results.
   */
  lintFiles(filePaths) {
    return filePaths.map(fp => this.lint(fp));
  }
}
