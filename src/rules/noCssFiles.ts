import type { HyperlinterConfig } from '../config';
import type { HyperlintDiagnostic } from '../diagnostics';
import { cssFiles, type ProjectModel } from '../project';

import type { HyperlintRule } from './contracts';

/** CSS belongs in the unified code-native styling system, never standalone files. */
export const noCssFilesRule: HyperlintRule = {
  id: 'HL110',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return cssFiles(project.getRootDir()).map((file) => ({
      rule: 'HL110',
      severity: config.rules.noCssFiles,
      file,
      message: 'CSS files are forbidden; use the unified code-native styling system.',
    }));
  },
};
