/**
 * Best practice rules for n8n workflows.
 */

/** BP-01: active should be false for templates */
const activeFlag = {
  id: 'BP-01',
  severity: 'error',
  description: 'Shared/template workflows should have active: false',
  check(workflow) {
    if (workflow.active === true) {
      return [{
        message: 'Workflow has active: true — templates should have active: false',
        fix: 'Set "active" to false',
      }];
    }
    return [];
  },
};

/** BP-02: Deprecated Function node */
const deprecatedNodes = {
  id: 'BP-02',
  severity: 'warning',
  description: 'Deprecated Function node should be replaced with Code node',
  check(workflow) {
    const issues = [];
    const deprecated = {
      'n8n-nodes-base.function': 'n8n-nodes-base.code',
      'n8n-nodes-base.functionItem': 'n8n-nodes-base.code',
    };

    for (const node of workflow.nodes || []) {
      if (deprecated[node.type]) {
        issues.push({
          message: `Node "${node.name}" uses deprecated "${node.type}" — use "${deprecated[node.type]}" instead`,
          node: node.name,
        });
      }
    }

    return issues;
  },
};

/** BP-03: Unconnected/orphaned nodes */
const orphanedNodes = {
  id: 'BP-03',
  severity: 'warning',
  description: 'Nodes with no input or output connections may be orphaned',
  check(workflow) {
    const issues = [];
    const connectedNodes = new Set();

    // Trigger nodes don't need input connections
    const triggerTypes = new Set([
      'n8n-nodes-base.webhook',
      'n8n-nodes-base.cron',
      'n8n-nodes-base.scheduleTrigger',
      'n8n-nodes-base.manualTrigger',
      'n8n-nodes-base.emailTrigger',
      'n8n-nodes-base.stickyNote',
      'n8n-nodes-base.noOp',
    ]);

    // Collect all nodes referenced in connections
    for (const [sourceName, outputs] of Object.entries(workflow.connections || {})) {
      connectedNodes.add(sourceName);
      if (!outputs?.main) continue;
      for (const outputGroup of outputs.main) {
        if (!Array.isArray(outputGroup)) continue;
        for (const conn of outputGroup) {
          if (conn.node) connectedNodes.add(conn.node);
        }
      }
    }

    for (const node of workflow.nodes || []) {
      if (triggerTypes.has(node.type)) continue;
      if (node.type?.endsWith('Trigger')) continue;
      if (!connectedNodes.has(node.name)) {
        issues.push({
          message: `Node "${node.name}" has no connections — may be orphaned`,
          node: node.name,
        });
      }
    }

    return issues;
  },
};

/** BP-04: Duplicate node names */
const duplicateNames = {
  id: 'BP-04',
  severity: 'error',
  description: 'Node names must be unique within a workflow',
  check(workflow) {
    const issues = [];
    const seen = new Map();

    for (const node of workflow.nodes || []) {
      if (seen.has(node.name)) {
        issues.push({
          message: `Duplicate node name: "${node.name}" — each node must have a unique name`,
          node: node.name,
        });
      } else {
        seen.set(node.name, true);
      }
    }

    return issues;
  },
};

import advancedRules from './advanced.js';

export default [activeFlag, deprecatedNodes, orphanedNodes, duplicateNames, ...advancedRules];
