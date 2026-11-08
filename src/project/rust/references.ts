import { scopeKey, type CrateModules, type RustScope } from './modules';


/** A crate-absolute path; `crate` names the crate's module map. */
interface RustPath {
  crate: CrateModules;
  segments: readonly string[];
}

/** A resolved path: each module prefix it traverses with the segment named inside that module. */
export interface RustReference {
  from: string;
  hops: readonly { file: string; name?: string }[];
  /** A glob import of the last module: every one of its public names may be used. */
  wildcard: boolean;
}

/**
 * Syntactic resolution of `crate::`, `self::`, `super::`, child-module,
 * workspace-crate and `use`-alias paths, including inside macro token trees.
 * Paths through external crates, locals, or macro-generated items are not evidence.
 */
export function crateReferences(modules: CrateModules, libraries: ReadonlyMap<string, CrateModules>): RustReference[] {
  const aliases = new Map<RustScope, Map<string, RustPath>>();
  const references: RustReference[] = [];
  const resolve = (segments: readonly string[], scope: RustScope): RustPath | undefined => {
    const [first, ...rest] = segments;
    const own = (base: readonly string[]): RustPath => ({ crate: modules, segments: [...base, ...rest] });
    if (first === 'crate') return own([]);
    if (first === 'self') return own(scope.path);
    if (first === 'super') {
      let base = scope.path.slice(0, -1);
      while (rest[0] === 'super') { rest.shift(); base = base.slice(0, -1); }
      return own(base);
    }
    const alias = aliases.get(scope)?.get(first);
    if (alias) return { crate: alias.crate, segments: [...alias.segments, ...rest] };
    if (modules.scopes.has(scopeKey([...scope.path, first]))) return own([...scope.path, first]);
    const library = libraries.get(first);
    return library ? { crate: library, segments: rest } : undefined;
  };
  const record = (from: string, target: RustPath, wildcard: boolean): void => {
    const hops: { file: string; name?: string }[] = [];
    for (let length = 0; length <= target.segments.length; length += 1) {
      const scope = target.crate.scopes.get(scopeKey(target.segments.slice(0, length)));
      if (scope) hops.push({ file: scope.file, name: target.segments[length] });
    }
    references.push({ from, hops, wildcard: wildcard && hops.at(-1)!.name === undefined });
  };

  for (const scope of modules.scopes.values()) {
    const bindings = new Map<string, RustPath>();
    aliases.set(scope, bindings);
    for (const leaf of scope.facts.uses) {
      const target = resolve(leaf.segments, scope);
      if (!target) continue;
      if (leaf.name) bindings.set(leaf.name, target);
      record(scope.file, target, leaf.wildcard);
    }
  }
  for (const scope of modules.scopes.values()) {
    for (const segments of scope.facts.paths) {
      const target = resolve(segments, scope);
      if (target) record(scope.file, target, false);
    }
  }
  return references;
}
