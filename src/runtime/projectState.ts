import fs from 'node:fs';
import path from 'node:path';

/** Target-private policy and caches follow Git metadata, including worktrees. */
export function projectStatePath(root: string, name: string): string {
  const marker = path.join(root, '.git');
  if (fs.statSync(marker).isDirectory()) return path.join(marker, 'hyperlinter', name);
  const match = /^gitdir: (.+)\s*$/m.exec(fs.readFileSync(marker, 'utf8'));
  if (!match) throw new Error(`Invalid Git metadata pointer: ${marker}`);
  return path.resolve(root, match[1], 'hyperlinter', name);
}
