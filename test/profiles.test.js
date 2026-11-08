import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, PROFILE_NAMES, resolveRuleSettings } from '../src/config.js';
import { ruleCatalog } from '../src/rules/index.js';

const ALL_IDS = ruleCatalog.map(rule => rule.id);
const SECURITY_IDS = ruleCatalog.filter(rule => rule.category === 'security').map(rule => rule.id);

describe('profile packs', () => {
  it('defines default, strict and security, each with a description', () => {
    assert.deepEqual(PROFILE_NAMES, ['default', 'strict', 'security']);
    for (const name of PROFILE_NAMES) {
      assert.equal(typeof PROFILES[name].description, 'string', `${name} has a description`);
      assert.ok(PROFILES[name].description.length > 0);
    }
  });

  it('default maps every rule to its built-in severity (changes nothing)', () => {
    const expected = Object.fromEntries(
      ruleCatalog.map(rule => [rule.id, rule.severity === 'warning' ? 'warn' : rule.severity])
    );
    assert.deepEqual(PROFILES.default.rules, expected);
    const { rules } = resolveRuleSettings({ profiles: ['default'] });
    assert.deepEqual(rules, expected, 'applying default alone equals built-ins');
  });

  it('strict maps every rule to error', () => {
    assert.equal(Object.keys(PROFILES.strict.rules).length, ALL_IDS.length);
    for (const id of ALL_IDS) {
      assert.equal(PROFILES.strict.rules[id], 'error', `${id} should be error under strict`);
    }
  });

  it('security keeps only security rules (and SCHEMA-01) as error', () => {
    for (const id of ALL_IDS) {
      const expected = id === 'SCHEMA-01' || SECURITY_IDS.includes(id) ? 'error' : 'off';
      assert.equal(PROFILES.security.rules[id], expected, `${id} should be ${expected} under security`);
    }
  });
});

describe('resolveRuleSettings', () => {
  it('defaults to the built-in severities for every rule', () => {
    const { rules, disabledRules, severityOverrides } = resolveRuleSettings();
    assert.equal(Object.keys(rules).length, ALL_IDS.length);
    assert.equal(rules['SCHEMA-02'], 'error');
    assert.equal(rules['SEC-01'], 'error');
    assert.equal(rules['SEC-03'], 'warn');
    assert.equal(rules['SEC-05'], 'warn');
    assert.equal(rules['BP-01'], 'error');
    assert.equal(rules['BP-05'], 'warn');
    assert.equal(disabledRules.size, 0);
    assert.equal(severityOverrides.get('SEC-03'), 'warning', 'warn maps to warning internally');
    assert.equal(severityOverrides.get('BP-01'), 'error');
  });

  it('lists rules sorted by id', () => {
    const { rules } = resolveRuleSettings();
    assert.deepEqual(Object.keys(rules), [...ALL_IDS].sort());
  });

  it('strict escalates every rule to error and disables nothing', () => {
    const { rules, disabledRules, severityOverrides } = resolveRuleSettings({ profiles: ['strict'] });
    for (const id of ALL_IDS) {
      assert.equal(rules[id], 'error', `${id} should be error`);
    }
    assert.equal(disabledRules.size, 0);
    assert.equal(severityOverrides.get('BP-05'), 'error', 'warning rules become errors');
  });

  it('security disables non-security rules and errors the rest', () => {
    const { rules, disabledRules, severityOverrides } = resolveRuleSettings({ profiles: ['security'] });
    for (const id of SECURITY_IDS) {
      assert.equal(rules[id], 'error', `${id} stays on`);
      assert.ok(!disabledRules.has(id));
    }
    assert.ok(disabledRules.has('BP-01'));
    assert.ok(disabledRules.has('BP-07'));
    assert.ok(disabledRules.has('SCHEMA-02'));
    assert.ok(!disabledRules.has('SCHEMA-01'), 'SCHEMA-01 always runs');
    assert.equal(severityOverrides.get('SEC-05'), 'error', 'security warnings escalate to errors');
  });

  it('applies profiles in order, later entries win', () => {
    const secThenStrict = resolveRuleSettings({ profiles: ['security', 'strict'] });
    assert.equal(secThenStrict.rules['BP-01'], 'error');
    assert.equal(secThenStrict.rules['SCHEMA-04'], 'error');
    assert.equal(secThenStrict.disabledRules.size, 0);

    const strictThenSec = resolveRuleSettings({ profiles: ['strict', 'security'] });
    assert.equal(strictThenSec.rules['SEC-01'], 'error');
    assert.equal(strictThenSec.rules['BP-01'], 'off');
    assert.equal(strictThenSec.rules['SCHEMA-04'], 'off');
    assert.ok(strictThenSec.disabledRules.has('BP-01'));
  });

  it('treats the default profile as a no-op baseline', () => {
    const { rules } = resolveRuleSettings({ profiles: ['default'] });
    assert.equal(rules['SEC-03'], 'warn');
    assert.equal(rules['BP-05'], 'warn');
  });

  it('explicit rules entries win over profiles', () => {
    const { rules, disabledRules } = resolveRuleSettings({
      profiles: ['strict'],
      rules: { 'BP-05': 'warn', 'SEC-03': 'off' },
    });
    assert.equal(rules['BP-05'], 'warn', 'file entry downgrades the strict profile');
    assert.ok(disabledRules.has('SEC-03'), 'file entry can disable under strict');
    assert.equal(rules['BP-01'], 'error', 'untouched rules keep the profile setting');
  });

  it('cli rules win over file rules entries', () => {
    const clamped = resolveRuleSettings({
      rules: { 'SEC-03': 'error' },
      cliRules: [{ id: 'SEC-03', severity: 'off' }],
    });
    assert.ok(clamped.disabledRules.has('SEC-03'));

    const escalated = resolveRuleSettings({
      rules: { 'BP-01': 'off' },
      cliRules: [{ id: 'BP-01', severity: 'error' }],
    });
    assert.equal(escalated.rules['BP-01'], 'error');
    assert.equal(escalated.severityOverrides.get('BP-01'), 'error');
  });

  it('profiles sit between built-ins and file entries', () => {
    const { rules } = resolveRuleSettings({
      profiles: ['security'],
      rules: { 'BP-01': 'warn' },
    });
    assert.equal(rules['BP-01'], 'warn', 'file entry revives a rule the profile turned off');
    assert.equal(rules['BP-03'], 'off', 'other non-security rules stay off');
  });

  it('a later default profile restores built-in severities after strict', () => {
    const { rules } = resolveRuleSettings({ profiles: ['strict', 'default'] });
    const catalog = ruleCatalog;
    for (const rule of catalog) {
      const builtin = rule.severity === 'warning' ? 'warn' : rule.severity;
      assert.equal(rules[rule.id], builtin, `${rule.id} back to built-in ${builtin}`);
    }
  });
});
