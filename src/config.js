import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_CONFIG = {
  rules: {},
  fix: false,
};

/**
 * Load .n8nlintrc.json from current directory or specified path.
 * Returns merged config with defaults.
 */
export function loadConfig(configPath) {
  const searchPath = configPath || resolve(process.cwd(), '.n8nlintrc.json');

  if (!existsSync(searchPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(searchPath, 'utf-8');
    const userConfig = JSON.parse(content);
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch (err) {
    console.error(`Warning: Failed to parse config file: ${err.message}`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Get disabled rules from config.
 * Config format: { rules: { "BP-01": "off", "SEC-02": "warn" } }
 */
export function getDisabledRules(config) {
  const disabled = new Set();
  for (const [ruleId, setting] of Object.entries(config.rules || {})) {
    if (setting === 'off' || setting === false) {
      disabled.add(ruleId);
    }
  }
  return disabled;
}

/**
 * Get severity overrides from config.
 */
export function getSeverityOverrides(config) {
  const overrides = new Map();
  for (const [ruleId, setting] of Object.entries(config.rules || {})) {
    if (setting === 'warn' || setting === 'warning') {
      overrides.set(ruleId, 'warning');
    } else if (setting === 'error') {
      overrides.set(ruleId, 'error');
    }
  }
  return overrides;
}
