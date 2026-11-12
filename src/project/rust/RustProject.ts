import fs from 'node:fs';
import path from 'node:path';
import {
  buildModuleGraph, moduleMetrics, type LanguageProfile, type ModuleFileMetrics, type ModuleGraph, type ModuleId,
  type ModuleMetrics, type PrivateModuleImport, type PublicName, type StructuralModel, type StructuralModule,
} from '../model';
import { discoverCrates } from './crates';
import { crateModules, scopeKey, type CrateModules } from './modules';
import { crateReferences, type RustReference } from './references';
import { rustFileParser, type RustItem, type ScopeFacts } from './syntax';

/**
 * Rust structural evidence from syntax alone. A module is a Rust module as
 * rustc sees it: each file reached by a `mod name;` declaration is its own
 * module, and inline `mod name { ... }` bodies belong to their file. A library
 * or binary root, or `mod.rs`, is identified by its directory; `name.rs` by
 * its path without the extension. Each additional Cargo target root (tests,
 * benches, examples, extra binaries) is its own module because Cargo requires
 * those roots to stay flat.
 *
 * Encapsulation is the compiler's job (`pub`, `pub(crate)`, private `mod`),
 * so there is no entrypoint-bypass evidence: a module's own file is its
 * boundary and its visible items are its public surface.
 */
export class RustProject implements StructuralModel {
  readonly language: LanguageProfile = { name: 'rust', entrypoint: 'module file', boundary: 'visibility' };
  private readonly modules = new Map<ModuleId, StructuralModule>();
  private readonly fileModules = new Map<string, ModuleId>();
  /** Files of the non-inline `mod name;` children each file declares. */
  private readonly childFiles = new Map<string, string[]>();
  private readonly items = new Map<string, RustItem[]>();
  private readonly consumers = new Map<ModuleId, Map<string, Set<ModuleId>>>();
  private readonly globConsumers = new Map<ModuleId, Set<ModuleId>>();
  private readonly crossReferences = new Map<ModuleId, number>();
  private readonly referencedContracts = new Map<ModuleId, Set<string>>();
  private readonly graph: ModuleGraph;

  private constructor(private readonly rootDir: string, crates: readonly CrateModules[], files: ReadonlyMap<string, ScopeFacts>) {
    const crateRoots = new Set(crates.map(({ crate }) => crate.root));
    for (const [file, facts] of files) {
      this.items.set(file, facts.items);
      this.fileModules.set(file, this.moduleOf(file, crateRoots));
    }
    for (const { scopes } of crates) {
      for (const scope of scopes.values()) {
        const parent = scopes.get(scopeKey(scope.path.slice(0, -1)));
        if (parent && scope.path.length && parent.file !== scope.file) {
          this.childFiles.set(parent.file, [...(this.childFiles.get(parent.file) ?? []), scope.file]);
        }
      }
    }
    for (const [file, id] of [...this.fileModules].sort(([left], [right]) => left.localeCompare(right))) {
      const module = this.modules.get(id) ?? { id, files: [] };
      this.modules.set(id, { id, files: [...module.files, file] });
    }
    const libraries = new Map(crates.flatMap((modules) => modules.crate.library ? [[modules.crate.library, modules] as const] : []));
    const edges: [ModuleId, ModuleId][] = [];
    for (const reference of crates.flatMap((modules) => crateReferences(modules, libraries))) {
      const edge = this.indexReference(reference);
      if (edge) edges.push(edge);
    }
    this.graph = buildModuleGraph(this.modules.keys(), edges);
  }

  /** Undefined when the repository has no Cargo package with a conventional target. */
  static async load(rootDir: string): Promise<RustProject | undefined> {
    const crates = discoverCrates(rootDir);
    if (!crates.length) return undefined;
    const parse = await rustFileParser();
    const files = new Map<string, ScopeFacts>();
    const facts = (file: string): ScopeFacts => {
      if (!files.has(file)) files.set(file, parse(fs.readFileSync(file, 'utf8')));
      return files.get(file)!;
    };
    return new RustProject(rootDir, crates.map((crate) => crateModules(crate, facts)), files);
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getModules(): readonly StructuralModule[] {
    return [...this.modules.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  getImports(module: StructuralModule | ModuleId): readonly ModuleId[] {
    return this.graph.dependencies.get(idOf(module)) ?? [];
  }

  getDependencyGraph(): ModuleGraph {
    return this.graph;
  }

  getPublicSurface(module: StructuralModule | ModuleId): readonly PublicName[] {
    const id = idOf(module);
    const names = new Set(this.filesOf(id).flatMap((file) => this.items.get(file)!.filter((item) => item.public)
      .map((item) => item.name)));
    const globs = this.globConsumers.get(id) ?? new Set();
    return [...names].sort().map((name) => ({
      name,
      externalReferences: new Set([...globs, ...(this.consumers.get(id)?.get(name) ?? [])]).size,
    }));
  }

  getFileMetrics(module: StructuralModule | ModuleId): readonly ModuleFileMetrics[] {
    return (this.modules.get(idOf(module))?.files ?? []).map((file) => {
      const items = this.items.get(file)!;
      return {
        file: this.fileId(file),
        declarations: new Set(items.filter((item) => item.declared).map((item) => item.name)).size,
        exports: new Set(items.filter((item) => item.public).map((item) => item.name)).size,
      };
    });
  }

  getEntrypointFiles(module: StructuralModule | ModuleId): readonly string[] {
    return this.filesOf(idOf(module)).map((file) => this.fileId(file));
  }

  getOwnedFiles(module: StructuralModule | ModuleId): readonly string[] {
    return this.filesOf(idOf(module)).flatMap((file) => [file, ...(this.childFiles.get(file) ?? [])]).map((file) => this.fileId(file));
  }

  /** Visibility is checked by rustc, so no path can reach a file its module did not expose. */
  getPrivateModuleImports(): readonly PrivateModuleImport[] {
    return [];
  }

  getAllMetrics(): readonly ModuleMetrics[] {
    return this.getModules().map(({ id }) => moduleMetrics(this, id,
      this.getFileMetrics(id).reduce((total, file) => total + file.declarations, 0), this.crossReferences.get(id) ?? 0,
      this.referencedContracts.get(id)?.size ?? 0));
  }

  private filesOf(id: ModuleId): readonly string[] {
    return this.modules.get(id)?.files ?? [];
  }

  /** Consumers count once per module; a path also uses each module name it traverses. */
  private indexReference({ from, hops, wildcard }: RustReference): [ModuleId, ModuleId] | undefined {
    const source = this.fileModules.get(from)!;
    for (const hop of hops) {
      const owner = this.fileModules.get(hop.file)!;
      if (owner === source || !hop.name) continue;
      const names = this.consumers.get(owner) ?? new Map<string, Set<ModuleId>>();
      names.set(hop.name, (names.get(hop.name) ?? new Set()).add(source));
      this.consumers.set(owner, names);
    }
    const target = hops.at(-1)!.file;
    const id = this.fileModules.get(target)!;
    if (id === source) return undefined;
    this.crossReferences.set(source, (this.crossReferences.get(source) ?? 0) + 1);
    const contract = `${target}::${hops.at(-1)!.name ?? '*'}`;
    this.referencedContracts.set(source, (this.referencedContracts.get(source) ?? new Set()).add(contract));
    if (wildcard) this.globConsumers.set(id, (this.globConsumers.get(id) ?? new Set()).add(source));
    return [source, id];
  }

  private moduleOf(file: string, crateRoots: ReadonlySet<string>): ModuleId {
    const directory = path.dirname(file);
    const base = path.basename(file);
    const ownsDirectory = base === 'mod.rs'
      || (crateRoots.has(file) && (base === 'lib.rs' || (base === 'main.rs' && !crateRoots.has(path.join(directory, 'lib.rs')))));
    return this.moduleId(ownsDirectory ? directory : file.slice(0, -3));
  }

  private moduleId(directory: string): ModuleId {
    return path.relative(this.rootDir, directory).split(path.sep).join('/') || '.';
  }

  private fileId(file: string): string {
    return path.relative(this.rootDir, file).split(path.sep).join('/');
  }
}

const idOf = (module: StructuralModule | ModuleId): ModuleId => typeof module === 'string' ? module : module.id;
