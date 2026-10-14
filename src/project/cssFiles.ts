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

/** Finds source-controlled stylesheets; generated and dependency trees are excluded. */
export function cssFiles(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fileName = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isSourceDirectory(root, fileName)) visit(fileName);
      } else if (entry.isFile() && entry.name.endsWith('.css')) {
        files.push(path.relative(root, fileName).split(path.sep).join('/'));
      }
    }
  };
  visit(root);
  return files.sort();
}
