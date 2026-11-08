import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// `target` is Cargo's build tree; it can hold packaged copies of whole crates.
const IGNORED_DIRECTORIES = new Set([
  '.git', '.next', 'artifacts', 'build', 'coverage', 'dist', 'node_modules',
  'out', 'runtime', 'playwright-report', 'target', 'test-results',
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

/**
 * Files the repository authors: Git's tracked and unignored files when the root
 * is in a work tree, so ignored vendored trees (e.g. a Cargo registry) stay out;
 * otherwise the conventional directory walk.
 */
export function authoredFilePaths(root: string): string[] {
  let listed: string;
  try {
    listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return sourceFilePaths(root, [root]);
  }
  return [...new Set(listed.split('\0').filter(Boolean))].map((file) => path.join(root, file))
    .filter((file) => isSourceDirectory(root, path.dirname(file)) && fs.existsSync(file));
}

/** Finds source-controlled stylesheets; generated and dependency trees are excluded. */
export function cssFiles(root: string): readonly string[] {
  return sourceFilePaths(root, [root]).filter(file => file.endsWith('.css'))
    .map(file => path.relative(root, file).split(path.sep).join('/')).sort();
}
