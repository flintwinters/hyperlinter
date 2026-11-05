import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRECTORIES = new Set([
  '.git', '.next', 'artifacts', 'build', 'coverage', 'dist', 'node_modules',
  'out', 'runtime', 'playwright-report', 'test-results',
]);

/** CSS and HTML share the same boundary between authored and generated trees. */
export function isSourceDirectory(root: string, directory: string): boolean {
  return !path.relative(root, directory).split(path.sep).some((part) => IGNORED_DIRECTORIES.has(part));
}

/** CSS and HTML traverse the same authored tree, including overlapping roots once. */
export function sourceFilePaths(root: string, directories: readonly string[]): string[] {
  const files: string[] = [];
  const visited = new Set<string>();
  const pending = [...directories];
  while (pending.length) {
    const directory = pending.pop()!;
    if (visited.has(directory) || !isSourceDirectory(root, directory)) continue;
    visited.add(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  return files;
}

/** Finds source-controlled stylesheets; generated and dependency trees are excluded. */
export function cssFiles(root: string): readonly string[] {
  return sourceFilePaths(root, [root]).filter(file => file.endsWith('.css'))
    .map(file => path.relative(root, file).split(path.sep).join('/')).sort();
}
