import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import { inlineStyles } from '../project/inlineStyles';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const noInlineStylesRule: HyperlintRule = {
  id: 'HL111',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return inlineStyles(project).map(({ file, line, signature }) => ({
      rule: 'HL111', severity: config.rules.noInlineStyles, file, line, signature,
      message: 'Inline JSX styles are forbidden; use the configured styling system.',
    }));
  },
};
