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
