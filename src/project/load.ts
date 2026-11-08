import fs from 'node:fs';
import path from 'node:path';
import { ProjectModel, type StructuralModel } from './model';
import { RustProject } from './rust';

export interface LoadedProjects {
  rootDir: string;
  /** Compiler evidence for TypeScript-only rules, when a tsconfig is present. */
  typescript?: ProjectModel;
  /** Every language model found at the root; language-neutral rules run on each. */
  models: readonly StructuralModel[];
}

/** Detect each supported language at the target root; at least one must be present. */
export async function loadProjects(tsconfigPath?: string): Promise<LoadedProjects> {
  const tsconfig = path.resolve(tsconfigPath ?? 'tsconfig.json');
  const rootDir = path.dirname(tsconfig);
  const typescript = fs.existsSync(tsconfig) ? ProjectModel.fromTsConfig(tsconfig) : undefined;
  const rust = await RustProject.load(rootDir);
  const models = [typescript, rust].filter((model): model is ProjectModel | RustProject => !!model);
  if (!models.length) {
    throw new Error(`No tsconfig.json or Cargo package found in ${rootDir}. Run Hyperlinter from the target repository root.`);
  }
  return { rootDir, typescript, models };
}
