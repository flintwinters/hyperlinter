import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

import type { ProjectModel } from './ProjectModel';

export interface SemanticFunction {
  id: string;
  hash: string;
  input: string;
  module: string;
  file: string;
  line: number;
}

/** Active means a current implementation, not inferred runtime reachability. */
export function semanticFunctions(project: ProjectModel): SemanticFunction[] {
  const functions: SemanticFunction[] = [];
  for (const module of project.getModules()) {
    for (const source of module.sourceFiles) {
      if (source.isDeclarationFile) continue;
      const file = path.relative(project.getRootDir(), source.fileName).split(path.sep).join('/');
      const visit = (node: ts.Node, ancestry: string): void => {
        const name = 'name' in node && node.name ? (node.name as ts.Node).getText(source) : '';
        const scope = name ? `${ancestry}/${name}` : ancestry;
        if (ts.isFunctionLike(node) && 'body' in node && node.body) {
          // Include enclosing names and full source; never silently truncate implementations.
          const input = `${scope}\n${node.getFullText(source).trim()}`;
          const hash = createHash('sha256').update(input).digest('hex');
          functions.push({
            id: `${file}:${functions.length}`, hash, input, module: module.id, file,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          });
        }
        ts.forEachChild(node, (child) => visit(child, scope));
      };
      visit(source, '');
    }
  }
  return functions;
}
