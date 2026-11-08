import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, parse as parsePath } from 'node:path';
import { ruleCatalog } from './rules/index.js';

const CONFIG_FILENAME = '.n8nlintrc.json';

const DEFAULT_CONFIG = {
  rules: {},
  fix: false,
};

/** Severity values accepted in config files and --rule flags. */
export const SEVERITY_VALUES = ['off', 'warn', 'error'];

const ALLOWED_CONFIG_KEYS = ['rules', 'profiles', 'fix'];

const knownRuleIds = new Set(ruleCatalog.map(rule => rule.id));
const knownRuleList = ruleCatalog.map(rule => rule.id).join(', ');

/**
 * Rule packs. "default" is the built-in baseline (no changes), "strict"
 * escalates every rule to an error, and "security" keeps only security rules
 * (plus SCHEMA-01, which parses the file and can never be turned off).
 */
export const PROFILES = {
  default: {
    description: 'Built-in severities for every rule (same as running with no config).',
    rules: {},
  },
  strict: {
    description: 'Every rule is reported as an error.',
    rules: Object.fromEntries(ruleCatalog.map(rule => [rule.id, 'error'])),
  },
  security: {
    description: 'Only security rules are checked, all as errors.',
    rules: Object.fromEntries(ruleCatalog.map(rule => [
      rule.id,
      rule.id === 'SCHEMA-01' || rule.category === 'security' ? 'error' : 'off',
    ])),
  },
};

export const PROFILE_NAMES = Object.keys(PROFILES);

/**
 * Error thrown for config problems the CLI reports with exit code 2.
 * `kind` distinguishes hard validation errors (unknown-rule, severity,
 * unknown-profile, ...) from shape problems the legacy loadConfig() wrapper
 * still downgrades to warnings (parse, rules-type).
 */
export class ConfigError extends Error {
  constructor(message, kind, extra = {}) {
    super(message);
    this.name = 'ConfigError';
    this.kind = kind;
    this.partial = extra.partial || null;
  }
}

/**
 * Find the nearest .n8nlintrc.json at or above startDir.
 * Walks up to the filesystem root (or stopDir, checked inclusively) and
 * returns the absolute path of the first match, or null.
 */
export function discoverConfigPath(startDir = process.cwd(), stopDir = null) {
  let dir = resolve(startDir);
  // symlink-safe stop comparison (macOS /var/folders -> /private/var/folders) without
  // changing the spelling of the path we return
  const stop = stopDir ? realpathSync(resolve(stopDir)) : parsePath(realpathSync(dir)).root;

  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (realpathSync(dir) === stop) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function assertRuleEntry(ruleId, value, source) {
  if (!knownRuleIds.has(ruleId)) {
    throw new ConfigError(
      `Unknown rule id "${ruleId}" in ${source}. Known rule ids: ${knownRuleList}`,
      'unknown-rule'
    );
  }
  if (ruleId === 'SCHEMA-01') {
    throw new ConfigError(
      'SCHEMA-01 (JSON syntax) always runs and cannot be configured',
      'schema-01'
    );
  }
  if (!SEVERITY_VALUES.includes(value)) {
    throw new ConfigError(
      `Invalid severity ${JSON.stringify(value)} for rule "${ruleId}" in ${source}. ` +
        `Expected one of: ${SEVERITY_VALUES.join(', ')}`,
      'severity'
    );
  }
}

/**
 * Read and strictly validate a config file.
 * Throws ConfigError on any problem; returns a normalized
 * { rules, profiles, fix } object on success.
 */
export function loadConfigFile(filePath) {
  const absolute = resolve(filePath);
  if (!existsSync(absolute)) {
    throw new ConfigError(`Config file not found: ${filePath}`, 'missing');
  }

  let content;
  try {
    content = readFileSync(absolute, 'utf-8');
  } catch (err) {
    throw new ConfigError(`Cannot read config file: ${err.message}`, 'unreadable');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ConfigError(`Invalid JSON in ${absolute}: ${err.message}`, 'parse');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`Config file must contain a JSON object: ${absolute}`, 'parse');
  }

  const unknownKeys = Object.keys(parsed).filter(key => !ALLOWED_CONFIG_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new ConfigError(
      `Unknown config option${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map(k => `"${k}"`).join(', ')} in ${absolute}. ` +
        `Allowed options: ${ALLOWED_CONFIG_KEYS.join(', ')}`,
      'unknown-key'
    );
  }

  let rules = {};
  if ('rules' in parsed && parsed.rules !== undefined) {
    if (typeof parsed.rules !== 'object' || parsed.rules === null || Array.isArray(parsed.rules)) {
      // Keep enough context for the legacy warning path in loadConfig().
      throw new ConfigError('"rules" must be an object mapping rule ids to severities', 'rules-type', {
        partial: { fix: typeof parsed.fix === 'boolean' ? parsed.fix : false },
      });
    }
    for (const [ruleId, value] of Object.entries(parsed.rules)) {
      assertRuleEntry(ruleId, value, `"rules" of ${absolute}`);
    }
    rules = { ...parsed.rules };
  }

  let profiles = [];
  if ('profiles' in parsed && parsed.profiles !== undefined) {
    if (!Array.isArray(parsed.profiles)) {
      throw new ConfigError('"profiles" must be an array of profile names', 'profiles-type');
    }
    for (const profile of parsed.profiles) {
      if (typeof profile !== 'string' || !PROFILE_NAMES.includes(profile)) {
        throw new ConfigError(
          `Unknown profile ${JSON.stringify(profile)}. Available profiles: ${PROFILE_NAMES.join(', ')}`,
          'unknown-profile'
        );
      }
    }
    profiles = [...parsed.profiles];
  }

  let fix = false;
  if ('fix' in parsed && parsed.fix !== undefined) {
    if (typeof parsed.fix !== 'boolean') {
      throw new ConfigError('"fix" must be a boolean', 'fix-type');
    }
    fix = parsed.fix;
  }

  return { rules, profiles, fix };
}

/**
 * Load config for the CLI: strict about everything.
 * With an explicit path, a missing or invalid file is a ConfigError (exit 2).
 * Without one, the nearest .n8nlintrc.json at or above the cwd is used; if
 * there is none, built-in defaults apply.
 * Returns { configFile, config } where configFile is null when none was found.
 */
export function loadCliConfig(configPath) {
  if (configPath) {
    const absolute = resolve(configPath);
    if (!existsSync(absolute)) {
      throw new ConfigError(`Config file not found: ${configPath}`, 'missing');
    }
    return { configFile: absolute, config: loadConfigFile(absolute) };
  }

  const found = discoverConfigPath();
  if (!found) {
    return { configFile: null, config: { rules: {}, profiles: [], fix: false } };
  }
  return { configFile: found, config: loadConfigFile(found) };
}

/**
 * Lenient loader kept for compatibility with earlier releases.
 * Missing files fall back to defaults; unparseable files and non-object
 * "rules" values warn and fall back (preserving "fix" when possible).
 * Hard validation errors introduced in 3.0.0 (unknown rule ids, invalid
 * severities, bad "profiles") still throw.
 */
export function loadConfig(configPath) {
  const path = configPath ? resolve(configPath) : discoverConfigPath();

  if (!path || !existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    return loadConfigFile(path);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    if (err.kind === 'parse') {
      console.error(`Warning: Failed to parse config file: ${err.message}`);
      return { ...DEFAULT_CONFIG };
    }
    if (err.kind === 'rules-type') {
      console.error('Warning: "rules" in config must be an object, ignoring');
      return { rules: {}, fix: err.partial?.fix ?? false };
    }
    throw err;
  }
}

/** Map catalog severities to the names used in config files and output. */
function toConfigSeverity(severity) {
  return severity === 'warning' ? 'warn' : severity;
}

/**
 * Resolve the effective rule settings.
 *
 * Precedence, lowest to highest:
 *   1. built-in rule severities
 *   2. profiles, applied in the order listed (later entries win)
 *   3. "rules" entries from the config file
 *   4. cliRules (parsed --rule flags)
 *
 * Returns { disabledRules, severityOverrides, rules } where rules maps every
 * known rule id to "off" | "warn" | "error" (sorted, for --print-config).
 */
export function resolveRuleSettings({ profiles = [], rules = {}, cliRules = [] } = {}) {
  const effective = new Map(ruleCatalog.map(rule => [rule.id, toConfigSeverity(rule.severity)]));

  for (const name of profiles) {
    const pack = PROFILES[name].rules;
    for (const [ruleId, severity] of Object.entries(pack)) {
      effective.set(ruleId, severity);
    }
  }

  for (const [ruleId, severity] of Object.entries(rules)) {
    effective.set(ruleId, severity);
  }

  for (const { id, severity } of cliRules) {
    effective.set(id, severity);
  }

  const disabledRules = new Set();
  const severityOverrides = new Map();
  for (const [ruleId, severity] of effective) {
    if (severity === 'off') {
      disabledRules.add(ruleId);
    } else {
      severityOverrides.set(ruleId, severity === 'warn' ? 'warning' : severity);
    }
  }

  const sortedRules = {};
  for (const ruleId of [...effective.keys()].sort()) {
    sortedRules[ruleId] = effective.get(ruleId);
  }

  return { disabledRules, severityOverrides, rules: sortedRules };
}

const RULE_FLAG_PATTERN = /^([A-Za-z][A-Za-z0-9]*-\d+)=(off|warn|error)$/;

/**
 * Parse a --rule flag value ("<rule-id>=<off|warn|error>").
 * Throws ConfigError with a usage hint on malformed input.
 */
export function parseRuleFlag(value) {
  const match = String(value).match(RULE_FLAG_PATTERN);
  if (!match) {
    throw new ConfigError(
      `Invalid --rule value ${JSON.stringify(value)}. Expected <rule-id>=<off|warn|error>, e.g. --rule BP-05=error`,
      'cli-rule'
    );
  }
  const [, ruleId, severity] = match;
  if (!knownRuleIds.has(ruleId)) {
    throw new ConfigError(
      `Unknown rule id "${ruleId}" in --rule. Known rule ids: ${knownRuleList}`,
      'unknown-rule'
    );
  }
  if (ruleId === 'SCHEMA-01') {
    throw new ConfigError('SCHEMA-01 (JSON syntax) always runs and cannot be configured', 'schema-01');
  }
  return { id: ruleId, severity };
}

/**
 * Get disabled rules from config.
 * Config format: { rules: { "BP-01": "off", "SEC-02": "warn" } }
 */
export function getDisabledRules(config) {
  const disabled = new Set();
  const rulesConfig = config.rules;
  if (!rulesConfig || typeof rulesConfig !== 'object' || Array.isArray(rulesConfig)) return disabled;
  for (const [ruleId, setting] of Object.entries(rulesConfig)) {
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
  const rulesConfig = config.rules;
  if (!rulesConfig || typeof rulesConfig !== 'object' || Array.isArray(rulesConfig)) return overrides;
  for (const [ruleId, setting] of Object.entries(rulesConfig)) {
    if (setting === 'warn' || setting === 'warning') {
      overrides.set(ruleId, 'warning');
    } else if (setting === 'error') {
      overrides.set(ruleId, 'error');
    }
  }
  return overrides;
}
