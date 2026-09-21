export type ModuleId = string;

export interface ModuleGraph {
  dependencies: ReadonlyMap<ModuleId, readonly ModuleId[]>;
  dependents: ReadonlyMap<ModuleId, readonly ModuleId[]>;
}
