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
    const patterns = [
      { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, label: 'Bearer token' },
      { regex: /["'](?:sk|pk|api|key|token|secret|password|auth)[_-]?[A-Za-z0-9]{16,}["']/gi, label: 'API key/token' },
      { regex: /(?:apiKey|api_key|apikey)\s*[:=]\s*["'][^"']{10,}["']/gi, label: 'API key assignment' },
      { regex: /xox[bporas]-[A-Za-z0-9-]{10,}/g, label: 'Slack token' },
      { regex: /ghp_[A-Za-z0-9]{36,}/g, label: 'GitHub token' },
      { regex: /sk-[A-Za-z0-9]{32,}/g, label: 'OpenAI key' },
    ];

    const jsonStr = JSON.stringify(workflow.nodes || []);

    for (const { regex, label } of patterns) {
      const matches = jsonStr.match(regex);
      if (matches) {
        for (const match of matches) {
          issues.push({
            message: `Possible ${label} detected: "${match.substring(0, 20)}..."`,
          });
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
      return [{
        message: `meta.instanceId found: "${workflow.meta.instanceId}" — strip before sharing`,
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
      return [{
        message: `Root-level id found: "${workflow.id}" — strip for portable templates`,
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
    const urlPattern = /https?:\/\/[^\s"']+[?&](?:token|key|api_key|apikey|access_token|auth)=[^\s"'&]+/gi;
    const jsonStr = JSON.stringify(workflow.nodes || []);

    const matches = jsonStr.match(urlPattern);
    if (matches) {
      for (const match of matches) {
        issues.push({
          message: `URL with auth parameter detected: "${match.substring(0, 50)}..."`,
        });
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
              message: `Node "${node.name}" has credential ID "${cred.id}" for "${type}" — consider stripping for shared templates`,
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
