import fs from 'node:fs';
import path from 'node:path';
import type { RustCrate } from './crates';
import type { ScopeFacts } from './syntax';

/** A Rust module: a file root or an inline `mod name { ... }` body. */
export interface RustScope {
  file: string;
  path: readonly string[];
  /** Directory holding files of `mod child;` declarations in this scope. */
  childDirectory: string;
  facts: ScopeFacts;
}

export interface CrateModules {
  crate: RustCrate;
  /** Scopes keyed by `a::b` path; the crate root is the empty key. */
  scopes: ReadonlyMap<string, RustScope>;
}

export const scopeKey = (segments: readonly string[]): string => segments.join('::');

/**
 * Follow `mod` declarations from the crate root the way rustc does without
 * `#[path]`: crate roots and `mod.rs` own their directory; `name.rs` owns `name/`.
 */
export function crateModules(crate: RustCrate, facts: (file: string) => ScopeFacts): CrateModules {
  const scopes = new Map<string, RustScope>();
  const pending: RustScope[] = [{ file: crate.root, path: [], childDirectory: path.dirname(crate.root), facts: facts(crate.root) }];
  while (pending.length) {
    const scope = pending.pop()!;
    if (scopes.has(scopeKey(scope.path))) continue;
    scopes.set(scopeKey(scope.path), scope);
    for (const { name, inline } of scope.facts.modules) {
      const childPath = [...scope.path, name];
      if (inline) {
        pending.push({ file: scope.file, path: childPath, childDirectory: path.join(scope.childDirectory, name), facts: inline });
        continue;
      }
      const file = [path.join(scope.childDirectory, `${name}.rs`), path.join(scope.childDirectory, name, 'mod.rs')]
        .find((candidate) => fs.existsSync(candidate));
      if (!file) continue;
      const childDirectory = path.basename(file) === 'mod.rs' ? path.dirname(file) : path.join(path.dirname(file), name);
      pending.push({ file, path: childPath, childDirectory, facts: facts(file) });
    }
  }
  return { crate, scopes };
}
