/**
 * Security rules for n8n workflows.
 */

/** SEC-01: Credential leaks in node parameters */
const credentialLeaks = {
  id: 'SEC-01',
  severity: 'error',
  description: 'Detects API keys, tokens, Bearer headers, and passwords in node parameters',
  check(workflow) {
    const issues = [];
    // HIGH-1 fix: All regex quantifiers are bounded to prevent ReDoS
    const patterns = [
      { regex: /Bearer\s+[A-Za-z0-9\-._~+/]{8,512}={0,4}/g, label: 'Bearer token' },
      { regex: /["'](?:sk|pk|api|key|token|secret|password|auth)[_-]?[A-Za-z0-9]{16,64}["']/gi, label: 'API key/token' },
      { regex: /(?:apiKey|api_key|apikey)\s*[:=]\s*["'][^"']{10,128}["']/gi, label: 'API key assignment' },
      { regex: /xox[bporas]-[A-Za-z0-9-]{10,128}/g, label: 'Slack token' },
      { regex: /ghp_[A-Za-z0-9]{36,64}/g, label: 'GitHub token' },
      { regex: /sk-[A-Za-z0-9]{32,64}/g, label: 'OpenAI key' },
    ];

    // MEDIUM-1 fix: Per-node scanning for proper node attribution
    for (const node of workflow.nodes || []) {
      const nodeStr = JSON.stringify(node.parameters || {});

      for (const { regex, label } of patterns) {
        regex.lastIndex = 0; // Reset stateful regex
        const matches = nodeStr.match(regex);
        if (matches) {
          for (const match of matches) {
            issues.push({
              message: `Possible ${label} in node "${node.name}": "${match.substring(0, 8)}...[REDACTED]"`,
              node: node.name,
            });
          }
        }
      }
    }

    return issues;
  },
};

/** SEC-02: meta.instanceId left in export */
const instanceId = {
  id: 'SEC-02',
  severity: 'error',
  description: 'meta.instanceId should be stripped from shared workflow exports',
  check(workflow) {
    if (workflow.meta?.instanceId) {
      // MEDIUM-3 fix: Truncate instanceId to prevent leaking the full value
      const id = String(workflow.meta.instanceId);
      return [{
        message: `meta.instanceId found: "${id.substring(0, 8)}..." — strip before sharing`,
        fix: 'Remove meta.instanceId from the workflow JSON',
      }];
    }
    return [];
  },
};

/** SEC-03: Root-level id (instance-specific) */
const rootId = {
  id: 'SEC-03',
  severity: 'warning',
  description: 'Root-level id is instance-specific and should be stripped for templates',
  check(workflow) {
    if ('id' in workflow && typeof workflow.id === 'string' && workflow.id.length > 0) {
      const id = String(workflow.id);
      return [{
        message: `Root-level id found: "${id.substring(0, 8)}..." — strip for portable templates`,
        fix: 'Remove the root-level "id" field',
      }];
    }
    return [];
  },
};

/** SEC-04: Hardcoded URLs with auth tokens in query strings */
const urlTokens = {
  id: 'SEC-04',
  severity: 'error',
  description: 'Detects hardcoded URLs containing auth tokens in query parameters',
  check(workflow) {
    const issues = [];

    // MEDIUM-1 fix: Per-node scanning for attribution
    // HIGH-1 fix: Bounded URL pattern (cap host+path at 256 chars) to prevent ReDoS
    for (const node of workflow.nodes || []) {
      const nodeStr = JSON.stringify(node.parameters || {});
      // Two-step approach: find URLs first, then check for auth params
      const urlMatches = nodeStr.match(/https?:\/\/[^\s"']{1,256}/gi) || [];

      for (const url of urlMatches) {
        if (/[?&](?:token|key|api_key|apikey|access_token|auth)=/i.test(url)) {
          // MEDIUM-2 fix: Redact token values before logging
          const redacted = url.replace(
            /([?&](?:token|key|api_key|apikey|access_token|auth)=)[^\s"'&]*/gi,
            '$1[REDACTED]'
          );
          issues.push({
            message: `URL with auth parameter in node "${node.name}": "${redacted.substring(0, 80)}"`,
            node: node.name,
          });
        }
      }
    }

    return issues;
  },
};

/** SEC-05: Credential names/IDs leaking internal naming */
const credentialNames = {
  id: 'SEC-05',
  severity: 'warning',
  description: 'Credential names/IDs may leak internal naming conventions',
  check(workflow) {
    const issues = [];

    for (const node of workflow.nodes || []) {
      if (node.credentials) {
        for (const [type, cred] of Object.entries(node.credentials)) {
          if (cred.id) {
            issues.push({
              message: `Node "${node.name}" has credential ID for "${type}" — consider stripping for shared templates`,
              node: node.name,
            });
          }
        }
      }
    }

    return issues;
  },
};

export default [credentialLeaks, instanceId, rootId, urlTokens, credentialNames];
