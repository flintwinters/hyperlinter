import path from 'node:path';
import ts from 'typescript';

import type { ModuleGraph, ModuleId } from './ModuleGraph';

interface ProjectModule {
  id: ModuleId;
  sourceFile: ts.SourceFile;
}

interface PublicSymbol {
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

  private constructor(program: ts.Program, rootDir: string, sourceFiles: readonly string[]) {
    this.program = program;
    this.checker = program.getTypeChecker();
    this.rootDir = rootDir;
    this.modulesById = new Map();
    this.moduleIdsByFile = new Map();

    for (const fileName of sourceFiles) {
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const id = this.moduleId(fileName);
      this.modulesById.set(id, { id, sourceFile });
      this.moduleIdsByFile.set(this.normalizedPath(fileName), id);
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
    const analysisFiles = parsed.fileNames.filter((fileName) => {
      const relative = path.relative(rootDir, fileName).split(path.sep).join('/');
      return !relative.startsWith('.next/') && !relative.startsWith('node_modules/');
    });
    return new ProjectModel(ts.createProgram(parsed.fileNames, parsed.options), rootDir, analysisFiles);
  }

  getModules(): readonly ProjectModule[] {
    return [...this.modulesById.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  getModuleIdForFile(fileName: string): ModuleId | undefined {
    return this.moduleIdsByFile.get(this.normalizedPath(fileName));
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
    const moduleSymbol = this.checker.getSymbolAtLocation(projectModule.sourceFile);
    if (!moduleSymbol) return [];

    return this.checker.getExportsOfModule(moduleSymbol)
      .map((symbol) => ({ name: symbol.getName(), symbol, externalReferences: this.getExternalReferences(symbol).length }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getExternalReferences(symbol: ts.Symbol): readonly ModuleId[] {
    return [...(this.externalReferences.get(this.unaliasedSymbol(symbol)) ?? [])].sort();
  }

  getType(symbol: ts.Symbol): ts.Type {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) throw new Error(`Symbol ${symbol.getName()} has no declaration.`);
    return this.checker.getTypeOfSymbolAtLocation(symbol, declaration);
  }

  getDependencyGraph(): ModuleGraph {
    return this.graph;
  }

  getPublicSurface(module: ProjectModule | ModuleId): readonly PublicSymbol[] {
    return this.getExports(module);
  }

  getMetrics(module: ProjectModule | ModuleId): ModuleMetrics {
    const projectModule = this.getModule(module);
    if (!projectModule) throw new Error(`Unknown module: ${this.moduleIdOf(module)}`);
    const declarations = this.topLevelSymbols(projectModule.sourceFile).size;
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

  private buildGraph(): ModuleGraph {
    const dependencies = new Map<ModuleId, readonly ModuleId[]>();
    const dependents = new Map<ModuleId, Set<ModuleId>>();
    for (const id of this.modulesById.keys()) dependents.set(id, new Set());

    for (const projectModule of this.modulesById.values()) {
      const imports = new Set<ModuleId>();
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const resolved = ts.resolveModuleName(
              node.moduleSpecifier.text,
              projectModule.sourceFile.fileName,
              this.program.getCompilerOptions(),
              ts.sys,
            ).resolvedModule;
            const target = resolved && this.moduleIdsByFile.get(this.normalizedPath(resolved.resolvedFileName));
            if (target && target !== projectModule.id) imports.add(target);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(projectModule.sourceFile);
      const sortedImports = [...imports].sort();
      dependencies.set(projectModule.id, sortedImports);
      for (const imported of sortedImports) dependents.get(imported)?.add(projectModule.id);
    }

    return {
      dependencies,
      dependents: new Map([...dependents].map(([id, values]) => [id, [...values].sort()])),
    };
  }

  private indexExternalReferences(): void {
    for (const projectModule of this.modulesById.values()) {
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
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(projectModule.sourceFile);
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
    visit(projectModule.sourceFile);
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

  private getModule(module: ProjectModule | ModuleId): ProjectModule | undefined {
    return typeof module === 'string' ? this.modulesById.get(module) : module;
  }

  private moduleIdOf(module: ProjectModule | ModuleId): ModuleId {
    return typeof module === 'string' ? module : module.id;
  }

  private moduleId(fileName: string): ModuleId {
    return path.relative(this.rootDir, fileName).split(path.sep).join('/');
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

  private isDeclarationName(node: ts.Identifier): boolean {
    const symbol = this.checker.getSymbolAtLocation(node);
    return symbol?.declarations?.some((declaration) => 'name' in declaration && declaration.name === node) ?? false;
  }
}
