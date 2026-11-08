import fs from 'node:fs';
import path from 'node:path';
import { authoredFilePaths, isSourceDirectory } from '../files';

/** One Cargo compilation root; `library` is its extern name when other crates can depend on it. */
export interface RustCrate {
  root: string;
  library?: string;
}

/**
 * Conventional Cargo targets of every authored manifest. Explicit `[lib] path`
 * and `name` are honoured; custom `[[bin]]`/`[[test]]` paths are not modelled.
 */
export function discoverCrates(rootDir: string): RustCrate[] {
  return authoredFilePaths(rootDir).filter((file) => path.basename(file) === 'Cargo.toml').sort()
    .flatMap((manifest) => manifestCrates(path.dirname(manifest), fs.readFileSync(manifest, 'utf8')))
    .filter((crate) => isSourceDirectory(rootDir, path.dirname(crate.root)));
}

function manifestCrates(directory: string, manifest: string): RustCrate[] {
  const packageName = tomlString(manifest, 'package', 'name');
  if (!packageName) return [];
  const existing = (file: string) => fs.existsSync(file) && fs.statSync(file).isFile();
  const library = path.join(directory, tomlString(manifest, 'lib', 'path') ?? 'src/lib.rs');
  const targets = (relative: string): string[] => {
    const parent = path.join(directory, relative);
    if (!fs.existsSync(parent)) return [];
    return fs.readdirSync(parent, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith('.rs')) return [path.join(parent, entry.name)];
      return entry.isDirectory() ? [path.join(parent, entry.name, 'main.rs')] : [];
    });
  };
  const binaries = [path.join(directory, 'src/main.rs'), path.join(directory, 'build.rs'),
    ...['src/bin', 'tests', 'benches', 'examples'].flatMap(targets)];
  return [
    ...(existing(library) ? [{ root: library, library: (tomlString(manifest, 'lib', 'name') ?? packageName).replace(/-/g, '_') }] : []),
    ...binaries.filter(existing).sort().map((root) => ({ root })),
  ];
}

/** A basic-string key of one `[section]`; sufficient for Cargo's name and path fields. */
function tomlString(manifest: string, section: string, key: string): string | undefined {
  const body = manifest.split(/^\s*\[/m).find((part) => part.startsWith(`${section}]`));
  return body?.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
}
