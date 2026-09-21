import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRECTORIES = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules']);

/** Finds source-controlled stylesheets; generated and dependency trees are excluded. */
export function cssFiles(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fileName = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(fileName);
      } else if (entry.isFile() && entry.name.endsWith('.css')) {
        files.push(path.relative(root, fileName).split(path.sep).join('/'));
      }
    }
  };
  visit(root);
  return files.sort();
}
