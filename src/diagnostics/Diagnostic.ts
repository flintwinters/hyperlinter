export type DiagnosticSeverity = 'info' | 'smell' | 'error';

export interface HyperlintDiagnostic {
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  module?: string;
  score?: number;
}
