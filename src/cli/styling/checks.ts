import fs from 'node:fs';
import { ProjectModel, cssFiles, inlineStyleBaseline, inlineStyles, newInlineStyles } from '../../project';
import { colorFileLimitRule, analyzeColorFiles } from '../../rules';
import { readBaseline, writeBaseline, baselinePath } from '../baseline';
import { formatDiagnostic } from '../output';

export function runStylingChecks(arguments_: readonly string[], json: boolean): void {
  if (arguments_.includes('--check-colors')) {
    const project = ProjectModel.fromTsConfig();
    const { policy, files, diagnostics } = analyzeColorFiles(project);
    if (json) fs.writeSync(1, `${JSON.stringify({ policy: policy ?? null, count: files.length, files, diagnostics }, null, 2)}\n`);
    else {
      fs.writeSync(1, policy ? `Hardcoded color files: ${files.length}; maximum: ${policy.maximum}.\n` : 'Color file cap disabled.\n');
      for (const { file, literals } of files) fs.writeSync(1, `${file}:${literals[0].line}\n`);
      for (const finding of diagnostics) fs.writeSync(2, `${formatDiagnostic(finding)}\n`);
    }
    process.exitCode = diagnostics.some(({ severity }) => severity === 'error') ? 1 : 0;
    process.exit();
  }

  if (arguments_.includes('--check-styles')) {
    const css = cssFiles(process.cwd());
    const project = ProjectModel.fromTsConfig();
    const styles = newInlineStyles(inlineStyles(project), readBaseline()?.inlineStyles);
    const colors = colorFileLimitRule.analyze(project);
    if (json) fs.writeSync(1, `${JSON.stringify({ css, styles, colors }, null, 2)}\n`);
    else {
      for (const file of css) process.stderr.write(`CSS file forbidden: ${file}\n`);
      for (const { file, line } of styles) process.stderr.write(`Inline JSX style forbidden: ${file}:${line}.\n`);
      for (const finding of colors) process.stderr.write(`${formatDiagnostic(finding)}\n`);
    }
    process.exitCode = css.length || styles.length || colors.some(({ severity }) => severity === 'error') ? 1 : 0;
    process.exit();
  }

  if (arguments_.includes('--check-no-css')) {
    const files = cssFiles(process.cwd());
    if (json) process.stdout.write(`${JSON.stringify({ files }, null, 2)}\n`);
    else if (files.length) process.stderr.write(`CSS files are forbidden: ${files.join(', ')}\n`);
    process.exitCode = files.length ? 1 : 0;
    process.exit();
  }

  if (arguments_.includes('--write-inline-style-baseline')) {
    const baseline = readBaseline();
    const nextBaseline = { metrics: baseline?.metrics ?? {}, inlineStyles: inlineStyleBaseline(inlineStyles(ProjectModel.fromTsConfig())) };
    writeBaseline(nextBaseline);
    if (json) process.stdout.write(`${JSON.stringify({ baselinePath: baselinePath(), baseline: nextBaseline }, null, 2)}\n`);
    process.exit();
  }
}
