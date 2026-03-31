/**
 * Advanced best practice rules for n8n workflows.
 */

const LARGE_WORKFLOW_THRESHOLD = 50;
const MAX_DFS_DEPTH = 500;

/** BP-05: Missing error handling on HTTP Request nodes */
const missingErrorHandling = {
  id: 'BP-05',
  severity: 'warning',
  description: 'HTTP Request nodes should have continueOnFail or an error workflow',
  check(workflow) {
    const issues = [];
    const httpTypes = [
      'n8n-nodes-base.httpRequest',
      'n8n-nodes-base.http',
    ];

    for (const node of workflow.nodes || []) {
      if (!httpTypes.includes(node.type)) continue;

      const hasRetryOnFail = node.retryOnFail === true;
      const hasContinueOnFail = node.continueOnFail === true;
      const hasErrorWorkflow = workflow.settings?.errorWorkflow;

      if (!hasRetryOnFail && !hasContinueOnFail && !hasErrorWorkflow) {
        issues.push({
          message: `Node "${node.name}" is an HTTP Request without error handling — add continueOnFail, retryOnFail, or set an error workflow`,
          node: node.name,
        });
      }
    }

    return issues;
  },
};

/** BP-06: Large workflow warning */
const largeWorkflow = {
  id: 'BP-06',
  severity: 'warning',
  description: `Workflows with >${LARGE_WORKFLOW_THRESHOLD} nodes should be decomposed into sub-workflows`,
  check(workflow) {
    const nodeCount = (workflow.nodes || []).length;
    if (nodeCount > LARGE_WORKFLOW_THRESHOLD) {
      return [{
        message: `Workflow has ${nodeCount} nodes (threshold: ${LARGE_WORKFLOW_THRESHOLD}) — consider breaking into sub-workflows using Execute Workflow nodes`,
      }];
    }
    return [];
  },
};

/** BP-07: Infinite loop risk */
const infiniteLoopRisk = {
  id: 'BP-07',
  severity: 'warning',
  description: 'Loop patterns without clear termination condition risk infinite execution',
  check(workflow) {
    const issues = [];
    const connections = workflow.connections || {};
    const nodeMap = new Map((workflow.nodes || []).map(n => [n.name, n]));

    // Build adjacency list
    const adj = new Map();
    for (const [source, outputs] of Object.entries(connections)) {
      if (!outputs?.main) continue;
      const targets = new Set();
      for (const group of outputs.main) {
        if (!Array.isArray(group)) continue;
        for (const conn of group) {
          if (conn.node) targets.add(conn.node);
        }
      }
      adj.set(source, targets);
    }

    // HIGH-4 fix: Corrected DFS — visited marked post-order, cycle dedup, depth guard
    const visited = new Set();
    const inStack = new Set();
    const reportedCycles = new Set();

    function dfs(node, path) {
      // MEDIUM-5 fix: Depth guard to prevent stack overflow
      if (path.length > MAX_DFS_DEPTH) return;

      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart);

        // Deduplicate cycles by sorted signature
        const key = [...cycle].sort().join(',');
        if (reportedCycles.has(key)) return;
        reportedCycles.add(key);

        const hasTermination = cycle.some(n => {
          const nodeData = nodeMap.get(n);
          return nodeData && (
            nodeData.type === 'n8n-nodes-base.if' ||
            nodeData.type === 'n8n-nodes-base.switch' ||
            nodeData.type === 'n8n-nodes-base.filter'
          );
        });

        if (!hasTermination) {
          issues.push({
            message: `Potential infinite loop: ${cycle.join(' → ')} → ${node} — no IF/Switch/Filter node found as termination condition`,
            node: cycle[0],
          });
        }
        return;
      }

      if (visited.has(node)) return;
      inStack.add(node);

      for (const target of adj.get(node) || []) {
        dfs(target, [...path, node]);
      }

      inStack.delete(node);
      visited.add(node); // Mark fully explored AFTER recursion (post-order)
    }

    for (const nodeName of adj.keys()) {
      if (!visited.has(nodeName)) {
        dfs(nodeName, []);
      }
    }

    return issues;
  },
};

export default [missingErrorHandling, largeWorkflow, infiniteLoopRisk];
