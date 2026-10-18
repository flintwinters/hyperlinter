import path from 'node:path';
import ts from 'typescript';
import { isSourceDirectory } from './cssFiles';

import type { ModuleGraph, ModuleId } from './ModuleGraph';

export interface ProjectModule {
  id: ModuleId;
  sourceFiles: readonly ts.SourceFile[];
  entryPoint: ts.SourceFile | null;
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

export interface PublicSymbol {
  name: string;
  symbol: ts.Symbol;
  externalReferences: number;
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

export class ProjectModel {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  private readonly rootDir: string;
  private readonly modulesById: Map<ModuleId, ProjectModule>;
  private readonly moduleIdsByFile: Map<string, ModuleId>;
  private readonly graph: ModuleGraph;
  private readonly externalReferences = new Map<ts.Symbol, Set<ModuleId>>();
  private readonly externalFileReferences = new Map<ts.Symbol, Set<string>>();

  private constructor(program: ts.Program, rootDir: string, sourceFiles: readonly string[]) {
    this.program = program;
    this.checker = program.getTypeChecker();
    this.rootDir = rootDir;
    this.modulesById = new Map();
    this.moduleIdsByFile = new Map();

    const filesByModule = new Map<ModuleId, ts.SourceFile[]>();
    for (const fileName of sourceFiles) {
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const id = this.moduleId(fileName);
      const files = filesByModule.get(id) ?? [];
      files.push(sourceFile);
      filesByModule.set(id, files);
      this.moduleIdsByFile.set(this.normalizedPath(fileName), id);
    }
    for (const [id, files] of filesByModule) {
      const entryPoints = files.filter((file) => this.isEntryPoint(file));
      this.modulesById.set(id, {
        id,
        sourceFiles: files.sort((left, right) => left.fileName.localeCompare(right.fileName)),
        entryPoint: entryPoints.length === 1 ? entryPoints[0] : null,
      });
    }

    this.graph = this.buildGraph();
    this.indexExternalReferences();
  }

  static fromTsConfig(tsconfigPath = 'tsconfig.json'): ProjectModel {
    const absoluteConfig = path.resolve(tsconfigPath);
    const config = ts.readConfigFile(absoluteConfig, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));

    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(absoluteConfig));
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
    }

    const rootDir = path.dirname(absoluteConfig);
    const analysisFiles = parsed.fileNames.filter((fileName) => isSourceDirectory(rootDir, path.dirname(fileName)));
    return new ProjectModel(ts.createProgram(parsed.fileNames, parsed.options), rootDir, analysisFiles);
  }

  getModules(): readonly ProjectModule[] {
    return [...this.modulesById.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  getModuleIdForFile(fileName: string): ModuleId | undefined {
    return this.moduleIdsByFile.get(this.normalizedPath(fileName));
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getImports(module: ProjectModule | ModuleId): readonly ModuleId[] {
    return this.graph.dependencies.get(this.moduleIdOf(module)) ?? [];
  }

  getDependents(module: ProjectModule | ModuleId): readonly ModuleId[] {
    return this.graph.dependents.get(this.moduleIdOf(module)) ?? [];
  }

  getExports(module: ProjectModule | ModuleId): readonly PublicSymbol[] {
    const projectModule = this.getModule(module);
    if (!projectModule) return [];
    return this.exportsOfFiles(projectModule.sourceFiles);
  }

  getPublicSurface(module: ProjectModule | ModuleId): readonly PublicSymbol[] {
    const projectModule = this.getModule(module);
    return projectModule?.entryPoint ? this.exportsOfFiles([projectModule.entryPoint]) : [];
  }

  getFileMetrics(module: ProjectModule | ModuleId): readonly ModuleFileMetrics[] {
    const projectModule = this.getModule(module);
    if (!projectModule) return [];
    return projectModule.sourceFiles.map((sourceFile) => ({
      file: this.fileId(sourceFile.fileName),
      declarations: this.topLevelSymbols(sourceFile).size,
      exports: this.exportsOfFiles([sourceFile]).length,
    }));
  }

  getEntrypointFiles(module: ProjectModule | ModuleId): readonly string[] {
    const projectModule = this.getModule(module);
    if (!projectModule) return [];
    return projectModule.sourceFiles
      .filter((sourceFile) => this.isEntryPoint(sourceFile))
      .map((sourceFile) => this.fileId(sourceFile.fileName));
  }

  getPrivateModuleImports(): readonly PrivateModuleImport[] {
    return this.importEdges().filter(({ target, resolvedFileName }) => target.entryPoint?.fileName !== resolvedFileName)
      .map(({ module, sourceFile, target, resolvedFileName }) => ({
        module: module.id, file: this.fileId(sourceFile.fileName), targetModule: target.id, targetFile: this.fileId(resolvedFileName),
      }));
  }

  private exportsOfFiles(sourceFiles: readonly ts.SourceFile[]): readonly PublicSymbol[] {
    const symbols = new Map<ts.Symbol, PublicSymbol>();
    for (const sourceFile of sourceFiles) {
      const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile);
      if (!moduleSymbol) continue;
      for (const symbol of this.checker.getExportsOfModule(moduleSymbol)) {
        const target = this.unaliasedSymbol(symbol);
        symbols.set(target, {
          name: symbol.getName(),
          symbol: target,
          externalReferences: this.getExternalReferences(target).length,
        });
      }
    }
    return [...symbols.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  getExternalReferences(symbol: ts.Symbol): readonly ModuleId[] {
    return [...(this.externalReferences.get(this.unaliasedSymbol(symbol)) ?? [])].sort();
  }

  getExternalFileReferences(symbol: ts.Symbol): readonly string[] {
    return [...(this.externalFileReferences.get(this.unaliasedSymbol(symbol)) ?? [])].sort();
  }

  /** Resolve value uses consistently, including shorthand properties and aliases. */
  getReferencedSymbol(node: ts.Identifier): ts.Symbol | undefined {
    const symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? this.checker.getShorthandAssignmentValueSymbol(node.parent)
      : this.checker.getSymbolAtLocation(node);
    if (!symbol || symbol.declarations?.some((declaration) => 'name' in declaration && declaration.name === node)) return undefined;
    return this.unaliasedSymbol(symbol);
  }

  getType(symbol: ts.Symbol): ts.Type {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) throw new Error(`Symbol ${symbol.getName()} has no declaration.`);
    return this.checker.getTypeOfSymbolAtLocation(symbol, declaration);
  }

  getDependencyGraph(): ModuleGraph {
    return this.graph;
  }

  getMetrics(module: ProjectModule | ModuleId): ModuleMetrics {
    const projectModule = this.getModule(module);
    if (!projectModule) throw new Error(`Unknown module: ${this.moduleIdOf(module)}`);
    const declarations = this.topLevelSymbolsAcross(projectModule.sourceFiles).size;
    const publicSurface = this.getPublicSurface(projectModule).length;
    const imports = this.getImports(projectModule);
    const references = this.crossModuleReferenceCount(projectModule);

    return {
      module: projectModule.id,
      declarations,
      publicSurface,
      publicSurfaceRatio: declarations === 0 ? 0 : publicSurface / declarations,
      dependencies: imports.length,
      dependents: this.getDependents(projectModule).length,
      crossModuleReferences: references,
    };
  }

  getAllMetrics(): readonly ModuleMetrics[] {
    return this.getModules().map((module) => this.getMetrics(module));
  }

  /** Cross-module import and re-export declarations; the graph and boundary checks share this resolution. */
  private importEdges(): { module: ProjectModule; sourceFile: ts.SourceFile; target: ProjectModule; resolvedFileName: string }[] {
    const edges: ReturnType<ProjectModel['importEdges']> = [];
    for (const module of this.modulesById.values()) {
      for (const sourceFile of module.sourceFiles) {
        const visit = (node: ts.Node): void => {
          if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            const resolvedFileName = this.resolvedModule(node, sourceFile)?.resolvedFileName;
            const targetId = resolvedFileName && this.moduleIdsByFile.get(this.normalizedPath(resolvedFileName));
            const target = targetId && this.modulesById.get(targetId);
            if (target && target.id !== module.id) edges.push({ module, sourceFile, target, resolvedFileName: resolvedFileName! });
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
      }
    }
    return edges;
  }

  private buildGraph(): ModuleGraph {
    const dependencies = new Map([...this.modulesById.keys()].map((id) => [id, new Set<ModuleId>()]));
    const dependents = new Map([...this.modulesById.keys()].map((id) => [id, new Set<ModuleId>()]));
    for (const { module, target } of this.importEdges()) {
      dependencies.get(module.id)!.add(target.id);
      dependents.get(target.id)!.add(module.id);
    }
    const sorted = (map: Map<ModuleId, Set<ModuleId>>) => new Map([...map].map(([id, values]) => [id, [...values].sort()]));
    return { dependencies: sorted(dependencies), dependents: sorted(dependents) };
  }

  private indexExternalReferences(): void {
    for (const projectModule of this.modulesById.values()) {
      for (const sourceFile of projectModule.sourceFiles) {
        const visit = (node: ts.Node): void => {
          if (ts.isIdentifier(node) && !this.isDeclarationName(node)) {
            const symbol = this.checker.getSymbolAtLocation(node);
            if (symbol) {
              const target = this.unaliasedSymbol(symbol);
              if (this.symbolDeclaredOutsideModule(target, projectModule.id)) {
                const references = this.externalReferences.get(target) ?? new Set<ModuleId>();
                references.add(projectModule.id);
                this.externalReferences.set(target, references);
              }
              if (this.symbolDeclaredOutsideFile(target, sourceFile)) {
                const references = this.externalFileReferences.get(target) ?? new Set<string>();
                references.add(this.fileId(sourceFile.fileName));
                this.externalFileReferences.set(target, references);
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
      }
    }
  }

  private crossModuleReferenceCount(projectModule: ProjectModule): number {
    let count = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !this.isDeclarationName(node)) {
        const symbol = this.checker.getSymbolAtLocation(node);
        if (symbol && this.symbolDeclaredOutsideModule(this.unaliasedSymbol(symbol), projectModule.id)) count += 1;
      }
      ts.forEachChild(node, visit);
    };
    for (const sourceFile of projectModule.sourceFiles) visit(sourceFile);
    return count;
  }

  private topLevelSymbols(sourceFile: ts.SourceFile): Set<ts.Symbol> {
    const symbols = new Set<ts.Symbol>();
    const addName = (name: ts.DeclarationName | undefined): void => {
      if (name && ts.isIdentifier(name)) {
        const symbol = this.checker.getSymbolAtLocation(name);
        if (symbol) symbols.add(this.unaliasedSymbol(symbol));
      }
    };
    for (const statement of sourceFile.statements) {
      if (ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach((declaration) => addName(declaration.name));
      else if ('name' in statement) addName(statement.name as ts.DeclarationName | undefined);
    }
    return symbols;
  }

  private topLevelSymbolsAcross(sourceFiles: readonly ts.SourceFile[]): Set<ts.Symbol> {
    const symbols = new Set<ts.Symbol>();
    for (const sourceFile of sourceFiles) {
      for (const symbol of this.topLevelSymbols(sourceFile)) symbols.add(symbol);
    }
    return symbols;
  }

  private getModule(module: ProjectModule | ModuleId): ProjectModule | undefined {
    return typeof module === 'string' ? this.modulesById.get(module) : module;
  }

  private moduleIdOf(module: ProjectModule | ModuleId): ModuleId {
    return typeof module === 'string' ? module : module.id;
  }

  private moduleId(fileName: string): ModuleId {
    return path.dirname(path.relative(this.rootDir, fileName)).split(path.sep).join('/');
  }

  /** Repository-relative, slash-separated identity used by every reported file. */
  fileId(fileName: string): string {
    return path.relative(this.rootDir, fileName).split(path.sep).join('/');
  }

  private isEntryPoint(sourceFile: ts.SourceFile): boolean {
    return /^index(?:\.stylex)?\.(?:[cm]?[jt]s|[jt]sx)$/.test(path.basename(sourceFile.fileName));
  }

  private resolvedModule(
    node: ts.ImportDeclaration | ts.ExportDeclaration,
    sourceFile: ts.SourceFile,
  ): ts.ResolvedModuleFull | undefined {
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return undefined;
    return ts.resolveModuleName(
      node.moduleSpecifier.text,
      sourceFile.fileName,
      this.program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule;
  }

  private normalizedPath(fileName: string): string {
    return path.resolve(fileName).replace(/\\/g, '/');
  }

  private unaliasedSymbol(symbol: ts.Symbol): ts.Symbol {
    return symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol;
  }

  private symbolDeclaredOutsideModule(symbol: ts.Symbol, moduleId: ModuleId): boolean {
    return symbol.declarations?.some((declaration) => (
      this.moduleIdsByFile.get(this.normalizedPath(declaration.getSourceFile().fileName)) !== moduleId
    )) ?? false;
  }

  private symbolDeclaredOutsideFile(symbol: ts.Symbol, sourceFile: ts.SourceFile): boolean {
    return symbol.declarations?.some((declaration) => declaration.getSourceFile() !== sourceFile) ?? false;
  }

  private isDeclarationName(node: ts.Identifier): boolean {
    const symbol = this.checker.getSymbolAtLocation(node);
    return symbol?.declarations?.some((declaration) => 'name' in declaration && declaration.name === node) ?? false;
  }
}
