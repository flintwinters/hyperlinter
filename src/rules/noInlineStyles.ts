import type { HyperlinterConfig } from '../config';
import type { HyperlintDiagnostic } from '../diagnostics';
import { inlineStyles, type ProjectModel } from '../project';

import type { HyperlintRule } from './contracts';

export const noInlineStylesRule: HyperlintRule = {
  id: 'HL111',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return inlineStyles(project).map(({ file, line, signature }) => ({
      rule: 'HL111', severity: config.rules.noInlineStyles, file, line, signature,
      message: 'Inline HTML/JSX styles and HTML stylesheet blocks are forbidden; use the configured styling system.',
    }));
  },
};
