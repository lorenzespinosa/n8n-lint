/**
 * Schema validation rules for n8n workflows.
 * SCHEMA-01 is handled in parseJSON (utils.js).
 */

/** SCHEMA-02: Required top-level fields */
const requiredFields = {
  id: 'SCHEMA-02',
  severity: 'error',
  description: 'Workflow must have required top-level fields: name, nodes, connections, active',
  check(workflow) {
    const issues = [];
    const required = ['name', 'nodes', 'connections'];

    for (const field of required) {
      if (!(field in workflow)) {
        issues.push({
          message: `Missing required field: "${field}"`,
        });
      }
    }

    if (!('active' in workflow)) {
      issues.push({
        message: 'Missing required field: "active" (should be false for templates)',
      });
    }

    return issues;
  },
};

/** SCHEMA-03: Node required fields */
const nodeFields = {
  id: 'SCHEMA-03',
  severity: 'error',
  description: 'Every node must have: id, name, type, typeVersion, position',
  check(workflow) {
    const issues = [];
    const required = ['id', 'name', 'type', 'typeVersion', 'position'];

    if (!Array.isArray(workflow.nodes)) return issues;

    for (const node of workflow.nodes) {
      for (const field of required) {
        if (!(field in node)) {
          issues.push({
            message: `Node "${node.name || node.id || 'unknown'}" missing field: "${field}"`,
            node: node.name || node.id,
          });
        }
      }
    }

    return issues;
  },
};

/** SCHEMA-04: Orphaned connections */
const orphanedConnections = {
  id: 'SCHEMA-04',
  severity: 'error',
  description: 'Connection references must point to existing node names',
  check(workflow) {
    const issues = [];
    const nodeNames = new Set((workflow.nodes || []).map(n => n.name));

    for (const [sourceName, outputs] of Object.entries(workflow.connections || {})) {
      if (!nodeNames.has(sourceName)) {
        issues.push({
          message: `Connection source "${sourceName}" does not match any node name`,
          node: sourceName,
        });
      }

      if (!Array.isArray(outputs?.main)) continue;

      for (const outputGroup of outputs.main) {
        if (!Array.isArray(outputGroup)) continue;
        for (const conn of outputGroup) {
          if (conn.node && !nodeNames.has(conn.node)) {
            issues.push({
              message: `Connection target "${conn.node}" (from "${sourceName}") does not match any node name`,
              node: conn.node,
            });
          }
        }
      }
    }

    return issues;
  },
};

export default [requiredFields, nodeFields, orphanedConnections];
