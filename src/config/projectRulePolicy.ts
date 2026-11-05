import fs from 'node:fs';
import path from 'node:path';

/** Explicit target policy; engine defaults and other consumers remain unchanged. */
export function disabledProjectRules(root: string): readonly string[] {
  const file = path.join(root, 'hyperlinter.project.json');
  if (!fs.existsSync(file)) return [];
  const disabled: unknown = JSON.parse(fs.readFileSync(file, 'utf8')).disabledRules;
  if (disabled === undefined) return [];
  if (!Array.isArray(disabled) || !disabled.every(isRuleId)) {
    throw new Error(`${file}: disabledRules must be an array of HL rule IDs.`);
  }
  return [...new Set(disabled)];
}

function isRuleId(value: unknown): value is string {
  return typeof value === 'string' && /^HL\d{3}$/.test(value);
}
