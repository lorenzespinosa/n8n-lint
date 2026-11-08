import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const readRepoFile = (relPath) => readFileSync(resolve(repoRoot, relPath), 'utf-8');

/**
 * Minimal YAML subset parser for the action and workflow files this repo
 * ships (nested block maps, block sequences, scalars, block literals).
 * It exists so the test suite can validate their structure fully offline,
 * with no YAML dependency; it throws on anything outside the subset.
 */
export function parseYaml(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    if (raw.includes('\t')) throw new Error(`Tab character in YAML: ${JSON.stringify(raw)}`);
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    lines.push({ indent: raw.length - raw.trimStart().length, raw });
  }
  let pos = 0;

  const body = (line) => line.raw.trim();

  const parseScalar = (s) => {
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      return s.slice(1, -1);
    }
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~' || s === '') return null;
    if (/^-?\d+$/.test(s)) return Number(s);
    return s;
  };

  const parseBlock = (indent) => {
    if (pos >= lines.length) return null;
    const first = body(lines[pos]);
    if (first === '-' || first.startsWith('- ')) {
      const list = [];
      while (pos < lines.length && lines[pos].indent === indent &&
             (body(lines[pos]) === '-' || body(lines[pos]).startsWith('- '))) {
        const item = body(lines[pos]);
        if (item === '-') {
          pos += 1;
          list.push(pos < lines.length && lines[pos].indent > indent ? parseBlock(lines[pos].indent) : null);
        } else if (/^("[^"]*"|'[^']*'|[^:]+):(\s|$)/.test(item.slice(2))) {
          // Map item: rewrite "- key: value" to "  key: value" at
          // indent + 2 so the item's following deeper lines parse as part
          // of one nested map.
          lines[pos] = { indent: indent + 2, raw: lines[pos].raw.replace(/^(\s*)- /, '$1  ') };
          list.push(parseBlock(indent + 2));
        } else {
          // Plain scalar item.
          pos += 1;
          list.push(parseScalar(item.slice(2).trim()));
        }
      }
      return list;
    }

    const map = {};
    while (pos < lines.length && lines[pos].indent === indent) {
      const line = body(lines[pos]);
      const match = line.match(/^("[^"]*"|'[^']*'|[^:]+):\s*(.*)$/);
      if (!match) throw new Error(`Cannot parse YAML mapping line: ${JSON.stringify(line)}`);
      const key = parseScalar(match[1].trim());
      const value = match[2].trim();
      pos += 1;

      if (value === '|' || value === '|-' || value === '|+') {
        const blockLines = [];
        const base = pos < lines.length && lines[pos].indent > indent ? lines[pos].indent : null;
        while (pos < lines.length && lines[pos].indent > indent) {
          blockLines.push(lines[pos].raw.slice(base));
          pos += 1;
        }
        const literal = blockLines.join('\n');
        map[key] = value === '|-' ? literal : `${literal}\n`;
      } else if (value === '') {
        map[key] = pos < lines.length && lines[pos].indent > indent
          ? parseBlock(lines[pos].indent)
          : null;
      } else {
        map[key] = parseScalar(value);
      }
    }
    return map;
  };

  const parsed = lines.length > 0 ? parseBlock(lines[0].indent) : null;
  if (pos !== lines.length) {
    throw new Error(`Unconsumed YAML input at line: ${JSON.stringify(body(lines[pos]))}`);
  }
  return parsed;
}

describe('parseYaml (validity check guard)', () => {
  it('should reject malformed YAML so the validity tests are not vacuous', () => {
    assert.throws(() => parseYaml('runs:\n  using composite\n'), /Cannot parse YAML mapping line/);
    assert.throws(() => parseYaml('runs:\n\tusing: composite\n'), /Tab character/);
    assert.throws(() => parseYaml('runs:\n  using: composite\n   steps: x\n'), /Unconsumed YAML input/);
  });

  it('should parse nested maps, sequences, scalars and block literals', () => {
    const parsed = parseYaml([
      'name: demo',
      'on:',
      '  push:',
      '    paths:',
      "      - 'src/**'",
      'jobs:',
      '  a:',
      '    steps:',
      '      - uses: ./',
      '        with:',
      '          n: 3',
      '      - run: |',
      '          echo one',
      '          echo two',
      '',
    ].join('\n'));
    assert.deepEqual(parsed, {
      name: 'demo',
      on: { push: { paths: ['src/**'] } },
      jobs: { a: { steps: [{ uses: './', with: { n: 3 } }, { run: 'echo one\necho two\n' }] } },
    });
  });
});

describe('action.yml', () => {
  const raw = readRepoFile('action.yml');

  it('should be valid block YAML with no tabs and a trailing newline', () => {
    assert.ok(!raw.includes('\t'), 'YAML must not contain tab characters');
    assert.ok(raw.endsWith('\n'), 'file ends with a newline');
    assert.doesNotThrow(() => parseYaml(raw));
  });

  it('should be a composite action with the documented inputs', () => {
    const action = parseYaml(raw);
    assert.equal(action.name, 'n8n-lint');
    assert.equal(action.runs.using, 'composite');

    assert.equal(action.inputs.workflows.default, '**/*.json');
    assert.equal(action.inputs.workflows.required, false);
    assert.equal(action.inputs.format.default, 'text');
    assert.equal(action.inputs.format.required, false);
    assert.equal(action.inputs.format.description.includes('html'), true);
  });

  it('should run the linter via npx and fail on error-severity findings', () => {
    const action = parseYaml(raw);
    assert.equal(action.runs.steps.length, 1);
    const step = action.runs.steps[0];
    assert.equal(step.shell, 'bash');
    assert.ok(step.name);
    assert.ok(step.run.includes('npx --yes github:lorenzespinosa/n8n-lint'), 'invokes the linter through npx');
    assert.ok(step.run.includes('--format'), 'forwards the format input');
    assert.ok(step.run.includes('${{ inputs.workflows }}'), 'forwards the workflows input');
    assert.ok(step.run.includes('exit 2'), 'fails the step when the glob matches nothing');
    // Exit codes propagate: error findings (1) and usage/config errors (2)
    // both fail the step, warnings do not.
  });

  it('should quote the format input to keep it a single argument', () => {
    const action = parseYaml(raw);
    assert.ok(action.runs.steps[0].run.includes(`--format '\${{ inputs.format }}'`));
  });
});

describe('.github/workflows/lint-example.yml', () => {
  const raw = readRepoFile('.github/workflows/lint-example.yml');

  it('should be valid block YAML with no tabs', () => {
    assert.ok(!raw.includes('\t'), 'YAML must not contain tab characters');
    assert.ok(raw.endsWith('\n'), 'file ends with a newline');
    assert.doesNotThrow(() => parseYaml(raw));
  });

  it('should lint the examples directory on push', () => {
    const workflow = parseYaml(raw);
    const paths = workflow.on.push.paths;
    assert.ok(Array.isArray(paths), 'push trigger is scoped by paths');
    assert.ok(paths.includes('examples/**'), 'runs when examples change');
    assert.ok(paths.includes('src/**'), 'runs when the linter source changes');
    assert.ok(paths.includes('action.yml'), 'runs when the action changes');
  });

  it('should use this repository action with a workflows input', () => {
    const workflow = parseYaml(raw);
    const lintStep = workflow.jobs.lint.steps.find(step => step.uses === './');
    assert.ok(lintStep, 'dogfoods the local action via uses: ./');
    assert.equal(lintStep.with.workflows, 'examples/clean-intake-workflow.json');
    assert.equal(lintStep.with.format, undefined, 'text is the action default');
  });
});
