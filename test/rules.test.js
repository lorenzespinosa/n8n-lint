import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import schemaRules from '../src/rules/schema/index.js';
import securityRules from '../src/rules/security/index.js';
import bestPracticeRules from '../src/rules/best-practices/index.js';

const ruleById = (rules, id) => {
  const found = rules.find(r => r.id === id);
  assert.ok(found, `Rule ${id} should be exported`);
  return found;
};

const makeNode = (name, type, extra = {}) => ({
  id: `id-${name}`,
  name,
  type,
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
  ...extra,
});

const baseWorkflow = () => ({
  name: 'Test Workflow',
  active: false,
  nodes: [],
  connections: {},
  settings: {},
});

describe('rules: module exports', () => {
  it('should export the expected rules with stable ids and severities', () => {
    const all = [...schemaRules, ...securityRules, ...bestPracticeRules];
    const byId = Object.fromEntries(all.map(r => [r.id, r.severity]));
    assert.deepEqual(byId, {
      'SCHEMA-02': 'error',
      'SCHEMA-03': 'error',
      'SCHEMA-04': 'error',
      'SEC-01': 'error',
      'SEC-02': 'error',
      'SEC-03': 'warning',
      'SEC-04': 'error',
      'SEC-05': 'warning',
      'BP-01': 'error',
      'BP-02': 'warning',
      'BP-03': 'warning',
      'BP-04': 'error',
      'BP-05': 'warning',
      'BP-06': 'warning',
      'BP-07': 'warning',
    });
    for (const r of all) {
      assert.equal(typeof r.check, 'function', `${r.id} should have a check function`);
      assert.ok(r.description.length > 0, `${r.id} should have a description`);
    }
  });
});

describe('SCHEMA-02: required top-level fields', () => {
  const rule = ruleById(schemaRules, 'SCHEMA-02');

  it('should flag every missing required field on an empty workflow', () => {
    const issues = rule.check({});
    assert.equal(issues.length, 4);
    for (const field of ['name', 'nodes', 'connections', 'active']) {
      assert.ok(
        issues.some(i => i.message.includes(`"${field}"`)),
        `should mention missing field ${field}`
      );
    }
  });

  it('should flag a missing active field separately from required fields', () => {
    const issues = rule.check({ name: 'x', nodes: [], connections: {} });
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /"active".*false for templates/);
  });

  it('should pass a workflow with all required fields', () => {
    assert.deepEqual(rule.check(baseWorkflow()), []);
  });
});

describe('SCHEMA-03: node required fields', () => {
  const rule = ruleById(schemaRules, 'SCHEMA-03');

  it('should return no issues when nodes is not an array', () => {
    assert.deepEqual(rule.check({ nodes: {} }), []);
  });

  it('should flag each missing field with the node name', () => {
    const workflow = { nodes: [{ name: 'Incomplete', type: 'n8n-nodes-base.set' }] };
    const issues = rule.check(workflow);
    assert.equal(issues.length, 3); // id, typeVersion, position
    assert.ok(issues.every(i => i.message.includes('Incomplete')));
    assert.ok(issues.every(i => i.node === 'Incomplete'));
  });

  it('should fall back to the node id when name is missing', () => {
    const workflow = { nodes: [{ id: 'abc123', type: 'n8n-nodes-base.set' }] };
    const issues = rule.check(workflow);
    assert.ok(issues.length > 0);
    assert.ok(issues.every(i => i.message.includes('"abc123"')));
  });

  it('should report "unknown" when a node has neither name nor id', () => {
    const workflow = { nodes: [{ type: 'n8n-nodes-base.set' }] };
    const issues = rule.check(workflow);
    assert.ok(issues.some(i => i.message.includes('unknown')));
  });

  it('should pass a complete node', () => {
    const workflow = { nodes: [makeNode('Complete', 'n8n-nodes-base.set')] };
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('SCHEMA-04: orphaned connections', () => {
  const rule = ruleById(schemaRules, 'SCHEMA-04');

  it('should flag a connection source that matches no node', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Real', 'n8n-nodes-base.set')];
    workflow.connections = { 'Ghost': { main: [[{ node: 'Real' }]] } };
    const issues = rule.check(workflow);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /Connection source "Ghost"/);
    assert.equal(issues[0].node, 'Ghost');
  });

  it('should flag a connection target that matches no node', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Real', 'n8n-nodes-base.set')];
    workflow.connections = { 'Real': { main: [[{ node: 'Deleted Node' }]] } };
    const issues = rule.check(workflow);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /Connection target "Deleted Node" \(from "Real"\)/);
  });

  it('should ignore non-array main outputs and output groups', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Real', 'n8n-nodes-base.set')];
    workflow.connections = {
      'Ghost': 'not-an-object',
      'Real': { main: ['not-an-array'] },
    };
    assert.deepEqual(rule.check(workflow).filter(i => i.node !== 'Ghost'), []);
  });

  it('should ignore connection entries without a node reference', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Real', 'n8n-nodes-base.set')];
    workflow.connections = { 'Real': { main: [[{ type: 'main' }]] } };
    assert.deepEqual(rule.check(workflow), []);
  });

  it('should pass when every connection resolves to real node names', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('A', 'n8n-nodes-base.set'), makeNode('B', 'n8n-nodes-base.set')];
    workflow.connections = { 'A': { main: [[{ node: 'B' }]] } };
    assert.deepEqual(rule.check(workflow), []);
  });

  it('should tolerate workflows without nodes or connections', () => {
    assert.deepEqual(rule.check({}), []);
  });
});

describe('SEC-01: credential leak patterns', () => {
  const rule = ruleById(securityRules, 'SEC-01');
  const workflowWithParams = (parameters) => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Leaky', 'n8n-nodes-base.httpRequest', { parameters })];
    return workflow;
  };

  // Synthetic detector samples. Each value is crafted to match exactly one
  // detector regex; nothing here is a real credential. The assignment sample
  // embeds an assignment-shaped string in a value (JSON keys are quoted by
  // JSON.stringify, so a plain key never matches), and suspicious-looking
  // fragments are assembled from parts on purpose.
  const apiKeyAssignment = { config: 'api' + "Key: 'abcdefghijklmnop'" };
  const labelAssertions = [
    ['Bearer token', { headers: 'Authorization: Bearer abcdef12345678' }],
    ['API key/token', { value: 'token_abcdefghijklmnop' }],
    ['API key assignment', apiKeyAssignment],
    ['Slack token', { channel: 'xoxb-1234567890abcdef' }],
    ['GitHub token', { pat: 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8' }],
    ['OpenAI key', { prompt: 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6' }],
  ];

  for (const [label, parameters] of labelAssertions) {
    it(`should detect a ${label.toLowerCase()}`, () => {
      const issues = rule.check(workflowWithParams(parameters));
      assert.ok(
        issues.some(i => i.message.includes(label)),
        `expected a "${label}" issue, got: ${JSON.stringify(issues)}`
      );
      assert.ok(issues.every(i => i.message.includes('Leaky')));
      assert.ok(issues.every(i => i.message.includes('[REDACTED]')));
    });
  }

  it('should return no issues for clean parameters', () => {
    assert.deepEqual(rule.check(workflowWithParams({ url: 'https://api.example.com/v1' })), []);
  });

  it('should return no issues for nodes without parameters', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [{ ...makeNode('Bare', 'n8n-nodes-base.set'), parameters: undefined }];
    assert.deepEqual(rule.check(workflow), []);
  });

  it('should find multiple matches in the same node', () => {
    const issues = rule.check(workflowWithParams({
      a: 'Bearer abcdef12345678',
      b: 'Bearer ghijkl87654321',
    }));
    assert.equal(issues.filter(i => i.message.includes('Bearer token')).length, 2);
  });
});

describe('SEC-02: meta.instanceId', () => {
  const rule = ruleById(securityRules, 'SEC-02');

  it('should flag an instanceId and truncate it in the message', () => {
    const workflow = baseWorkflow();
    workflow.meta = { instanceId: 'abcdefgh12345678' };
    const issues = rule.check(workflow);
    assert.equal(issues.length, 1);
    assert.ok(issues[0].message.includes('abcdefgh...'));
    assert.ok(!issues[0].message.includes('12345678'), 'full id must not leak');
    assert.ok(issues[0].fix.includes('instanceId'));
  });

  it('should pass when meta has no instanceId', () => {
    const workflow = baseWorkflow();
    workflow.meta = { templateCredsSetupCompleted: true };
    assert.deepEqual(rule.check(workflow), []);
    assert.deepEqual(rule.check(baseWorkflow()), []);
  });
});

describe('SEC-03: root-level id', () => {
  const rule = ruleById(securityRules, 'SEC-03');

  it('should flag a non-empty string id and truncate it', () => {
    const workflow = baseWorkflow();
    workflow.id = 'zzzzzzzz-wxyz-1234';
    const issues = rule.check(workflow);
    assert.equal(issues.length, 1);
    assert.ok(issues[0].message.includes('"zzzzzzzz..."'));
    assert.ok(issues[0].fix.includes('"id"'));
  });

  it('should ignore empty or non-string ids', () => {
    assert.deepEqual(rule.check({ ...baseWorkflow(), id: '' }), []);
    assert.deepEqual(rule.check({ ...baseWorkflow(), id: 12345 }), []);
    assert.deepEqual(rule.check(baseWorkflow()), []);
  });
});

describe('SEC-04: auth tokens in URLs', () => {
  const rule = ruleById(securityRules, 'SEC-04');
  const workflowWithUrl = (url) => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Fetcher', 'n8n-nodes-base.httpRequest', {
      parameters: { url },
    })];
    return workflow;
  };

  it('should flag and redact a token query parameter', () => {
    const issues = rule.check(workflowWithUrl('https://api.example.com/v1?token=aaaa1111bbbb2222&page=1'));
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /token=\[REDACTED\]/);
    assert.ok(!issues[0].message.includes('aaaa1111bbbb2222'), 'token value must be redacted');
    assert.ok(issues[0].message.includes('Fetcher'));
  });

  it('should flag api_key passed as a second query parameter', () => {
    const url = 'https://api.example.com/v1?page=1&api' + '_key=cccc' + '3333dddd4';
    const issues = rule.check(workflowWithUrl(url));
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /api_key=\[REDACTED\]/);
  });

  it('should pass URLs without auth parameters', () => {
    assert.deepEqual(rule.check(workflowWithUrl('https://api.example.com/v1?page=1')), []);
  });

  it('should pass nodes without parameters', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [{ ...makeNode('Bare', 'n8n-nodes-base.set'), parameters: undefined }];
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('SEC-05: credential name leaks', () => {
  const rule = ruleById(securityRules, 'SEC-05');

  it('should flag a node carrying a credential id', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Authed', 'n8n-nodes-base.httpRequest', {
      credentials: { httpHeaderAuth: { id: 'cred-123' } },
    })];
    const issues = rule.check(workflow);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /Node "Authed" has credential ID for "httpHeaderAuth"/);
    assert.equal(issues[0].node, 'Authed');
  });

  it('should pass credentials without an id and nodes without credentials', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [
      makeNode('NoId', 'n8n-nodes-base.httpRequest', {
        credentials: { httpHeaderAuth: {} },
      }),
      makeNode('Plain', 'n8n-nodes-base.set'),
    ];
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('BP-01: active flag', () => {
  const rule = ruleById(bestPracticeRules, 'BP-01');

  it('should flag active: true with a fix hint', () => {
    const workflow = baseWorkflow();
    workflow.active = true;
    const issues = rule.check(workflow);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /active: true/);
    assert.ok(issues[0].fix.includes('false'));
  });

  it('should pass active: false and missing active', () => {
    assert.deepEqual(rule.check(baseWorkflow()), []);
    const workflow = baseWorkflow();
    delete workflow.active;
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('BP-02: deprecated nodes', () => {
  const rule = ruleById(bestPracticeRules, 'BP-02');

  it('should flag both deprecated Function node variants', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [
      makeNode('Old Fn', 'n8n-nodes-base.function'),
      makeNode('Old Item Fn', 'n8n-nodes-base.functionItem'),
    ];
    const issues = rule.check(workflow);
    assert.equal(issues.length, 2);
    assert.match(issues[0].message, /uses deprecated "n8n-nodes-base\.function"/);
    assert.match(issues[0].message, /use "n8n-nodes-base\.code" instead/);
    assert.match(issues[1].message, /n8n-nodes-base\.code/);
  });

  it('should pass the modern Code node', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Modern', 'n8n-nodes-base.code')];
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('BP-03: orphaned nodes', () => {
  const rule = ruleById(bestPracticeRules, 'BP-03');

  it('should flag an unconnected non-trigger node', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Lone', 'n8n-nodes-base.set')];
    const issues = rule.check(workflow);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /Node "Lone" has no connections/);
    assert.equal(issues[0].node, 'Lone');
  });

  it('should pass nodes that appear in connections', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('A', 'n8n-nodes-base.set'), makeNode('B', 'n8n-nodes-base.set')];
    workflow.connections = { 'A': { main: [[{ node: 'B' }]] } };
    assert.deepEqual(rule.check(workflow), []);
  });

  it('should never flag known trigger and utility types', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [
      makeNode('Webhook', 'n8n-nodes-base.webhook'),
      makeNode('Cron', 'n8n-nodes-base.cron'),
      makeNode('Sticky', 'n8n-nodes-base.stickyNote'),
      makeNode('NoOp', 'n8n-nodes-base.noOp'),
    ];
    assert.deepEqual(rule.check(workflow), []);
  });

  it('should not flag node types ending in Trigger', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Custom', 'n8n-nodes-base.clockTrigger')];
    assert.deepEqual(rule.check(workflow), []);
  });

  it('should ignore malformed connection structures', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('A', 'n8n-nodes-base.set')];
    workflow.connections = {
      'A': {},
      'A2': { main: 'not-an-array' },
      'A3': { main: ['not-an-array'] },
      'A4': { main: [[{ type: 'main' }]] },
    };
    // A is a connection source, so it counts as connected
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('BP-04: duplicate node names', () => {
  const rule = ruleById(bestPracticeRules, 'BP-04');

  it('should flag every repeat of a duplicated name', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [
      makeNode('Same', 'n8n-nodes-base.set'),
      makeNode('Same', 'n8n-nodes-base.code'),
      makeNode('Same', 'n8n-nodes-base.noOp'),
    ];
    const issues = rule.check(workflow);
    assert.equal(issues.length, 2);
    assert.ok(issues.every(i => i.message.includes('Duplicate node name: "Same"')));
  });

  it('should pass unique node names', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('A', 'n8n-nodes-base.set'), makeNode('B', 'n8n-nodes-base.set')];
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('BP-05: missing error handling', () => {
  const rule = ruleById(bestPracticeRules, 'BP-05');
  const httpWorkflow = (nodeExtra = {}, settings = {}) => {
    const workflow = baseWorkflow();
    workflow.settings = settings;
    workflow.nodes = [makeNode('Http', 'n8n-nodes-base.httpRequest', nodeExtra)];
    return workflow;
  };

  it('should flag an HTTP Request node without error handling', () => {
    const issues = rule.check(httpWorkflow());
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /Node "Http" is an HTTP Request without error handling/);
    assert.equal(issues[0].node, 'Http');
  });

  it('should accept retryOnFail', () => {
    assert.deepEqual(rule.check(httpWorkflow({ retryOnFail: true })), []);
  });

  it('should accept continueOnFail', () => {
    assert.deepEqual(rule.check(httpWorkflow({ continueOnFail: true })), []);
  });

  it('should accept a workflow-level error workflow', () => {
    assert.deepEqual(rule.check(httpWorkflow({}, { errorWorkflow: 'wf-123' })), []);
  });

  it('should flag the legacy n8n-nodes-base.http type too', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('OldHttp', 'n8n-nodes-base.http')];
    assert.equal(rule.check(workflow).length, 1);
  });

  it('should ignore non-HTTP nodes', () => {
    const workflow = baseWorkflow();
    workflow.nodes = [makeNode('Set', 'n8n-nodes-base.set')];
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('BP-06: large workflow', () => {
  const rule = ruleById(bestPracticeRules, 'BP-06');

  it('should flag workflows above the 50-node threshold', () => {
    const workflow = baseWorkflow();
    workflow.nodes = Array.from({ length: 51 }, (_, i) => makeNode(`N${i}`, 'n8n-nodes-base.noOp'));
    const issues = rule.check(workflow);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /51 nodes \(threshold: 50\)/);
  });

  it('should pass workflows at or below the threshold', () => {
    const workflow = baseWorkflow();
    workflow.nodes = Array.from({ length: 50 }, (_, i) => makeNode(`N${i}`, 'n8n-nodes-base.noOp'));
    assert.deepEqual(rule.check(workflow), []);
  });
});

describe('BP-07: infinite loop risk', () => {
  const rule = ruleById(bestPracticeRules, 'BP-07');

  const loopWorkflow = (nodes, connections) => {
    const workflow = baseWorkflow();
    workflow.nodes = nodes;
    workflow.connections = connections;
    return workflow;
  };

  it('should flag a cycle with no termination node', () => {
    const issues = rule.check(loopWorkflow(
      [makeNode('A', 'n8n-nodes-base.set'), makeNode('B', 'n8n-nodes-base.set')],
      { 'A': { main: [[{ node: 'B' }]] }, 'B': { main: [[{ node: 'A' }]] } }
    ));
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /A → B → A/);
    assert.equal(issues[0].node, 'A');
  });

  it('should pass a cycle containing an IF node', () => {
    assert.deepEqual(rule.check(loopWorkflow(
      [makeNode('Gate', 'n8n-nodes-base.if'), makeNode('B', 'n8n-nodes-base.set')],
      { 'Gate': { main: [[{ node: 'B' }]] }, 'B': { main: [[{ node: 'Gate' }]] } }
    )), []);
  });

  it('should pass a cycle containing a Switch or Filter node', () => {
    assert.deepEqual(rule.check(loopWorkflow(
      [makeNode('S', 'n8n-nodes-base.switch'), makeNode('F', 'n8n-nodes-base.filter')],
      { 'S': { main: [[{ node: 'F' }]] }, 'F': { main: [[{ node: 'S' }]] } }
    )), []);
  });

  it('should pass acyclic workflows, including diamonds', () => {
    assert.deepEqual(rule.check(loopWorkflow(
      [
        makeNode('A', 'n8n-nodes-base.set'),
        makeNode('B', 'n8n-nodes-base.set'),
        makeNode('C', 'n8n-nodes-base.set'),
        makeNode('D', 'n8n-nodes-base.set'),
      ],
      {
        'A': { main: [[{ node: 'B' }, { node: 'C' }]] },
        'B': { main: [[{ node: 'D' }]] },
        'C': { main: [[{ node: 'D' }]] },
      }
    )), []);
  });

  it('should report each distinct cycle once', () => {
    const issues = rule.check(loopWorkflow(
      [
        makeNode('A', 'n8n-nodes-base.set'),
        makeNode('B', 'n8n-nodes-base.set'),
        makeNode('C', 'n8n-nodes-base.set'),
        makeNode('D', 'n8n-nodes-base.set'),
      ],
      {
        'A': { main: [[{ node: 'B' }]] },
        'B': { main: [[{ node: 'A' }]] },
        'C': { main: [[{ node: 'D' }]] },
        'D': { main: [[{ node: 'C' }]] },
      }
    ));
    assert.equal(issues.length, 2);
  });

  it('should ignore malformed connection structures', () => {
    assert.deepEqual(rule.check(loopWorkflow(
      [makeNode('A', 'n8n-nodes-base.set')],
      { 'A': {}, 'B': { main: 'nope' }, 'C': { main: ['nope'] }, 'D': { main: [[{}]] } }
    )), []);
  });
});
