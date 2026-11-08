import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';

/**
 * Syntax evidence of one Rust module scope. Trees are reduced to these facts
 * and freed at once: retaining them exhausts the WebAssembly heap on large workspaces.
 */
export interface ScopeFacts {
  items: RustItem[];
  modules: { name: string; inline?: ScopeFacts }[];
  uses: UseLeaf[];
  /** `a::b::c` token chains outside `use`, including inside macro token trees. */
  paths: string[][];
}

let loading: Promise<Parser> | undefined;

/** One WebAssembly grammar instance per process; it needs no native toolchain. */
async function rustParser(): Promise<Parser> {
  loading ??= (async () => {
    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load(createRequire(import.meta.url).resolve('tree-sitter-rust/tree-sitter-rust.wasm')));
    return parser;
  })();
  return loading;
}

export async function rustFileParser(): Promise<(text: string) => ScopeFacts> {
  const parser = await rustParser();
  return (text) => {
    const tree = parser.parse(text)!;
    try {
      return scopeFacts(tree.rootNode);
    } finally {
      tree.delete();
    }
  };
}

const PATH_TOKENS = new Set(['identifier', 'type_identifier', 'crate', 'self', 'super']);

/** File and inline-module scopes are reduced with an explicit stack, outermost first. */
function scopeFacts(root: Node): ScopeFacts {
  const facts = emptyFacts(root);
  const pending: [Node, ScopeFacts][] = [[root, facts]];
  while (pending.length) {
    const [scope, target] = pending.pop()!;
    for (const item of children(scope, true).filter((child) => child.type === 'mod_item')) {
      const body = item.childForFieldName('body');
      const inline = body ? emptyFacts(body) : undefined;
      target.modules.push({ name: item.childForFieldName('name')!.text, inline });
      if (body) pending.push([body, inline!]);
    }
    collectPaths(scope, target);
  }
  return facts;
}

function emptyFacts(scope: Node): ScopeFacts {
  return { items: scopeItems(scope), modules: [], uses: [], paths: [] };
}

/** Token-level chains so paths inside macro token trees count like parsed paths. */
function collectPaths(scope: Node, facts: ScopeFacts): void {
  let chain: string[] = [];
  let continued = false;
  const flush = (): void => {
    if (chain.length > 1 && !continued) facts.paths.push(chain);
    chain = [];
    continued = false;
  };
  walkScope(scope, (node) => {
    if (node.type === 'use_declaration') {
      facts.uses.push(...useLeaves(node));
      return false;
    }
    if (node.childCount > 0) return true;
    if (node.type === '::') {
      if (!chain.length) chain = ['::'];
      continued = true;
    } else if (PATH_TOKENS.has(node.type) && continued) {
      chain.push(node.text);
      continued = false;
    } else {
      flush();
      if (PATH_TOKENS.has(node.type)) chain = [node.text];
    }
    return false;
  });
  flush();
}

/** Pre-order traversal of one scope; nested inline module bodies are their own scopes. */
function walkScope(scope: Node, visit: (node: Node) => boolean): void {
  const pending = children(scope).reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === 'mod_item' && node.childForFieldName('body')) continue;
    if (visit(node)) pending.push(...children(node).reverse());
  }
}

function children(node: Node, named = false): Node[] {
  return (named ? node.namedChildren : node.children).filter((child): child is Node => child !== null);
}

const NAMED_ITEMS = new Set([
  'const_item', 'enum_item', 'function_item', 'mod_item', 'static_item', 'struct_item', 'trait_item', 'type_item', 'union_item',
]);

/** A name a Rust scope declares, or re-exports with `pub use`. */
export interface RustItem {
  name: string;
  public: boolean;
  declared: boolean;
}

/** Any visibility except `pub(self)` reaches beyond the declaring file module. */
function isPublic(node: Node): boolean {
  const visibility = children(node, true).find((child) => child.type === 'visibility_modifier');
  return !!visibility && visibility.text.replace(/\s/g, '') !== 'pub(self)';
}

/** Named items directly inside a file root or inline module body. */
function scopeItems(scope: Node): RustItem[] {
  return children(scope, true).flatMap((node): RustItem[] => {
    if (NAMED_ITEMS.has(node.type)) {
      const name = node.childForFieldName('name')?.text;
      return name ? [{ name, public: isPublic(node), declared: true }] : [];
    }
    if (node.type !== 'use_declaration' || !isPublic(node)) return [];
    return useLeaves(node).flatMap(({ name }) => name ? [{ name, public: true, declared: false }] : []);
  });
}

/** One imported path from a `use` tree; `name` is the local binding unless it is a glob. */
export interface UseLeaf {
  segments: string[];
  name?: string;
  wildcard: boolean;
}

function useLeaves(declaration: Node): UseLeaf[] {
  const argument = declaration.childForFieldName('argument');
  const leaves: UseLeaf[] = [];
  const pending: [Node, string[]][] = argument ? [[argument, []]] : [];
  const path = (child: Node | null): string[] => child ? pathSegments(child) : [];
  while (pending.length) {
    const [node, prefix] = pending.pop()!;
    if (node.type === 'use_list') pending.push(...children(node, true).reverse().map((child): [Node, string[]] => [child, prefix]));
    else if (node.type === 'scoped_use_list') {
      pending.push([node.childForFieldName('list')!, [...prefix, ...path(node.childForFieldName('path'))]]);
    } else if (node.type === 'use_wildcard') {
      leaves.push({ segments: [...prefix, ...path(children(node, true)[0] ?? null)], wildcard: true });
    } else if (node.type === 'use_as_clause') {
      const alias = node.childForFieldName('alias')?.text;
      leaves.push({ ...binding([...prefix, ...path(node.childForFieldName('path'))]), name: alias === '_' ? undefined : alias });
    } else leaves.push(binding([...prefix, ...pathSegments(node)]));
  }
  return leaves;
}

/** `use a::b::{self}` binds `b` to the module path itself. */
function binding(segments: string[]): UseLeaf {
  const resolved = segments.at(-1) === 'self' ? segments.slice(0, -1) : segments;
  return { segments: resolved, name: resolved.at(-1), wildcard: false };
}

/** Flatten `a::b::c`; a leading `::` yields an unresolvable `::` segment. */
function pathSegments(node: Node): string[] {
  const segments: string[] = [];
  let current: Node | null = node;
  while (current?.type === 'scoped_identifier') {
    segments.push(current.childForFieldName('name')?.text ?? '');
    current = current.childForFieldName('path');
  }
  segments.push(current ? current.text : '::');
  return segments.reverse();
}
