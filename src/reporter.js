import chalk from 'chalk';

/**
 * Format lint results for terminal output.
 */
export function reportResults(allResults, options = {}) {
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalFiles = 0;
  let skippedFiles = 0;

  for (const { file, results, skipped } of allResults) {
    if (skipped) {
      skippedFiles++;
      continue;
    }

    totalFiles++;
    const errors = results.filter(r => r.severity === 'error');
    const warnings = results.filter(r => r.severity === 'warning');

    totalErrors += errors.length;
    totalWarnings += warnings.length;

    if (results.length === 0) {
      if (!options.quiet) {
        console.log(chalk.green('✓') + ' ' + chalk.dim(file));
      }
      continue;
    }

    console.log(chalk.bold(file));

    for (const result of results) {
      const icon = result.severity === 'error'
        ? chalk.red('✗')
        : chalk.yellow('⚠');
      const ruleTag = chalk.dim(`[${result.ruleId}]`);
      const nodeRef = result.node ? chalk.cyan(` (${result.node})`) : '';
      console.log(`  ${icon} ${ruleTag} ${result.message}${nodeRef}`);

      if (result.fix && !options.quiet) {
        console.log(chalk.dim(`    Fix: ${result.fix}`));
      }
    }

    console.log('');
  }

  // Summary line
  console.log('');
  const parts = [];
  parts.push(`${totalFiles} file${totalFiles !== 1 ? 's' : ''} checked`);

  if (totalErrors > 0) {
    parts.push(chalk.red(`${totalErrors} error${totalErrors !== 1 ? 's' : ''}`));
  }
  if (totalWarnings > 0) {
    parts.push(chalk.yellow(`${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}`));
  }
  if (totalErrors === 0 && totalWarnings === 0) {
    parts.push(chalk.green('0 issues'));
  }
  if (skippedFiles > 0) {
    parts.push(chalk.dim(`${skippedFiles} skipped (not n8n workflows)`));
  }

  console.log(parts.join(' · '));

  return { totalErrors, totalWarnings, totalFiles, skippedFiles };
}

/**
 * Format results as JSON array.
 */
export function reportJSON(allResults) {
  const output = allResults
    .filter(r => !r.skipped)
    .map(({ file, results }) => ({
      file,
      issues: results.map(r => ({
        ruleId: r.ruleId,
        severity: r.severity,
        message: r.message,
        node: r.node,
        fix: r.fix || null,
      })),
    }));

  console.log(JSON.stringify(output, null, 2));

  const totalErrors = output.reduce((sum, f) => sum + f.issues.filter(i => i.severity === 'error').length, 0);
  return { totalErrors };
}

/** Escape text for safe interpolation into HTML content and attributes. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HTML_STYLE = `
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    margin: 0 auto;
    max-width: 60rem;
    padding: 2rem 1.25rem 4rem;
    line-height: 1.5;
  }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1rem; margin: 1.75rem 0 0.5rem; word-break: break-all; }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 1rem 0 0.5rem;
  }
  .summary span {
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0.15rem 0.75rem;
    font-size: 0.85rem;
  }
  .summary .errors { color: #b91c1c; }
  .summary .warnings { color: #a16207; }
  .summary .clean { color: #15803d; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; vertical-align: top; }
  thead th { border-bottom: 2px solid currentColor; }
  tbody tr { border-bottom: 1px solid rgba(127, 127, 127, 0.35); }
  td.sev { white-space: nowrap; font-weight: 600; }
  tr.error td.sev { color: #b91c1c; }
  tr.warning td.sev { color: #a16207; }
  td.rule { white-space: nowrap; }
  td.node, td.fix { word-break: break-all; }
  .clean-files { color: rgba(127, 127, 127, 0.9); font-size: 0.85rem; word-break: break-all; }
  .no-findings { color: #15803d; }
  footer { margin-top: 3rem; font-size: 0.8rem; color: rgba(127, 127, 127, 0.9); }
`.trim();

/**
 * Format results as a single self-contained HTML report: one document with
 * inline CSS, no scripts and no external resources, printed to stdout so it
 * can be redirected to a file (`n8n-lint --format html . > report.html`).
 */
export function reportHTML(allResults) {
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalFiles = 0;
  let skippedFiles = 0;
  const cleanFiles = [];
  const sections = [];

  for (const { file, results, skipped } of allResults) {
    if (skipped) {
      skippedFiles++;
      continue;
    }

    totalFiles++;
    const errors = results.filter(r => r.severity === 'error').length;
    const warnings = results.filter(r => r.severity === 'warning').length;
    totalErrors += errors;
    totalWarnings += warnings;

    if (results.length === 0) {
      cleanFiles.push(file);
      continue;
    }

    const rows = results.map(r => [
      `      <tr class="${escapeHtml(r.severity)}">`,
      `        <td class="sev">${escapeHtml(r.severity)}</td>`,
      `        <td class="rule">${escapeHtml(r.ruleId)}</td>`,
      `        <td class="node">${r.node ? escapeHtml(r.node) : ''}</td>`,
      `        <td class="message">${escapeHtml(r.message)}</td>`,
      `        <td class="fix">${r.fix ? escapeHtml(r.fix) : ''}</td>`,
      '      </tr>',
    ].join('\n'));

    sections.push([
      `    <section class="file">`,
      `      <h2>${escapeHtml(file)}</h2>`,
      `      <table>`,
      `        <thead>`,
      `          <tr><th>Severity</th><th>Rule</th><th>Node</th><th>Message</th><th>Fix</th></tr>`,
      `        </thead>`,
      `        <tbody>`,
      rows.join('\n'),
      `        </tbody>`,
      `      </table>`,
      `    </section>`,
    ].join('\n'));
  }

  const summaryParts = [
    `<span>${totalFiles} file${totalFiles !== 1 ? 's' : ''} checked</span>`,
    `<span class="${totalErrors > 0 ? 'errors' : 'clean'}">${totalErrors} error${totalErrors !== 1 ? 's' : ''}</span>`,
    `<span class="${totalWarnings > 0 ? 'warnings' : 'clean'}">${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}</span>`,
  ];
  if (skippedFiles > 0) {
    summaryParts.push(`<span>${skippedFiles} skipped (not n8n workflows)</span>`);
  }

  const bodyBlocks = [];
  if (sections.length === 0) {
    bodyBlocks.push('    <p class="no-findings">No findings.</p>');
  } else {
    bodyBlocks.push(sections.join('\n'));
  }
  if (cleanFiles.length > 0) {
    bodyBlocks.push(`    <p class="clean-files">Clean (no findings): ${cleanFiles.map(escapeHtml).join(', ')}</p>`);
  }

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <title>n8n-lint report</title>',
    `  <style>${HTML_STYLE}</style>`,
    '</head>',
    '<body>',
    '  <main>',
    '    <h1>n8n-lint report</h1>',
    `    <div class="summary">${summaryParts.join('\n    ')}</div>`,
    bodyBlocks.join('\n'),
    '    <footer>Generated by n8n-lint. Self-contained report: inline CSS, no scripts, no external resources.</footer>',
    '  </main>',
    '</body>',
    '</html>',
  ].join('\n');

  console.log(html);

  return { totalErrors, totalWarnings, totalFiles, skippedFiles };
}
