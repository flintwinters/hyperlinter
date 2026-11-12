import { ProjectModel } from '../project';
import { loadHyperlinterConfig } from '../config';
import { applyExactCloneRefactors } from '../clones';
import { applyPrivateUnusedExportFixes } from './privateExports';

export function applyRequestedFixes(arguments_: readonly string[]) {
  const fixProject = arguments_.includes('--fix-private-exports')
    ? ProjectModel.fromTsConfig()
    : undefined;
  const fixes = fixProject ? applyPrivateUnusedExportFixes(fixProject) : [];
  let sourceChanged = fixes.length > 0;
  if (arguments_.includes('--fix')) {
    const project = ProjectModel.fromTsConfig();
    sourceChanged = applyExactCloneRefactors(project, loadHyperlinterConfig()).length > 0 || sourceChanged;
  }
  return { fixes, sourceChanged };
}
