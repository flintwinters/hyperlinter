import ts from 'typescript';

export function projectFor(fileName: string) {
  const program = ts.createProgram([fileName], { strict: true, allowNonTsExtensions: true });
  const sourceFile = program.getSourceFile(fileName)!;
  return {
    checker: program.getTypeChecker(),
    getModuleIdForFile: () => 'clones.ts',
    getModules: () => [{ id: 'clones.ts', sourceFiles: [sourceFile] }],
  } as never;
}
