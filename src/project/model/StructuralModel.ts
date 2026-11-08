import type { ModuleGraph, ModuleId } from './ModuleGraph';

/**
 * Language-neutral structural evidence. Rules that consume only this contract
 * apply to every supported language; rules needing compiler-specific evidence
 * (types, resolved calls, syntax clones) stay bound to that language's model.
 */
export interface StructuralModel {
  readonly language: LanguageProfile;
  getRootDir(): string;
  getModules(): readonly StructuralModule[];
  getImports(module: StructuralModule | ModuleId): readonly ModuleId[];
  getDependencyGraph(): ModuleGraph;
  getPublicSurface(module: StructuralModule | ModuleId): readonly PublicName[];
  getFileMetrics(module: StructuralModule | ModuleId): readonly ModuleFileMetrics[];
  getEntrypointFiles(module: StructuralModule | ModuleId): readonly string[];
  getPrivateModuleImports(): readonly PrivateModuleImport[];
  getAllMetrics(): readonly ModuleMetrics[];
}

export interface LanguageProfile {
  name: 'typescript' | 'rust';
  /** How diagnostics name a module's single public boundary file. */
  entrypoint: string;
}

/** A directory-scoped module; `files` are absolute paths in stable order. */
export interface StructuralModule {
  id: ModuleId;
  files: readonly string[];
}

export interface PublicName {
  name: string;
  externalReferences: number;
}

export interface ModuleFileMetrics {
  file: string;
  declarations: number;
  exports: number;
}

export interface PrivateModuleImport {
  module: ModuleId;
  file: string;
  targetModule: ModuleId;
  targetFile: string;
}

export interface ModuleMetrics {
  module: ModuleId;
  declarations: number;
  publicSurface: number;
  publicSurfaceRatio: number;
  dependencies: number;
  dependents: number;
  crossModuleReferences: number;
}

/** Metrics share one derivation so languages cannot disagree on ratios or counts. */
export function moduleMetrics(
  model: StructuralModel, module: ModuleId, declarations: number, crossModuleReferences: number,
): ModuleMetrics {
  const publicSurface = model.getPublicSurface(module).length;
  return {
    module,
    declarations,
    publicSurface,
    publicSurfaceRatio: declarations === 0 ? 0 : publicSurface / declarations,
    dependencies: model.getImports(module).length,
    dependents: model.getDependencyGraph().dependents.get(module)?.length ?? 0,
    crossModuleReferences,
  };
}

/** Graph maps hold every module, with sorted neighbours, regardless of language. */
export function buildModuleGraph(modules: Iterable<ModuleId>, edges: Iterable<[ModuleId, ModuleId]>): ModuleGraph {
  const ids = [...modules];
  const dependencies = new Map(ids.map((id) => [id, new Set<ModuleId>()]));
  const dependents = new Map(ids.map((id) => [id, new Set<ModuleId>()]));
  for (const [from, to] of edges) {
    dependencies.get(from)!.add(to);
    dependents.get(to)!.add(from);
  }
  const sorted = (map: Map<ModuleId, Set<ModuleId>>) => new Map([...map].map(([id, values]) => [id, [...values].sort()]));
  return { dependencies: sorted(dependencies), dependents: sorted(dependents) };
}
