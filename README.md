# Hyperlinter

Hyperlinter is a TypeScript linter for code and repository structure. It uses
the TypeScript compiler graph to report dependency cycles, unused public
exports, and coupling outliers, and also checks local source patterns.

## Add to a project

Add this repository as a submodule at `tools/hyperlint`, then install the host
project's dependencies (or install this package's dependencies independently):

```bash
git submodule add https://github.com/flintwinters/hyperlinter.git tools/hyperlint
npx tsx tools/hyperlint/src/cli.ts
```

Run the command from the target repository root. It reads that repository's
`tsconfig.json`, persists local run evidence in `tools/hyperlint/runtime/`, and
uses the target repository's local `.git/hyperlinter/baseline.json` for
public-surface and inline-style baselines. This file stays outside Git history
and cannot be committed with project or submodule source. Every
module is also subject to the configured maximum exported-symbol count.
Standalone `.css` files are forbidden; code-native styles are the sole styling system.
Inline JSX styles are also rejected. Existing instances can be recorded in a
local baseline so the check blocks new instances.
The root `AGENTS.md` is capped at 150 lines so it remains a broad-strokes,
semantic entrypoint for agents rather than an all-encompassing project map.
An architectural module is the source-owning directory: it must have exactly
one `index.*` public entrypoint, and every other file in that directory is
private to that module. Internal files may use TypeScript exports for internal
imports, but other modules must import the directory index. An entrypoint file
with one top-level declaration and one export is rejected as an unnecessary
architectural boundary.

## Commands

```bash
npx tsx tools/hyperlint/src/cli.ts
npx tsx tools/hyperlint/src/cli.ts --write-baseline
npx tsx tools/hyperlint/src/cli.ts --write-inline-style-baseline
npx tsx tools/hyperlint/src/cli.ts --check-styles
npx tsx tools/hyperlint/src/cli.ts --source-budget check
npx tsx tools/hyperlint/src/cli.ts --fix-private-exports
npx tsx tools/hyperlint/src/cli.ts --history
npx tsx tools/hyperlint/src/cli.ts --format=json
npx tsx tools/hyperlint/src/cli.ts --fix
```

The evidence ledger and baseline are local. Review baseline changes before
writing them; a fresh checkout needs its own baseline provisioned.

`--fix` extracts eligible exact AST clones: non-exported, synchronous top-level
functions with the configured minimum meaningful AST nodes. Detection alpha-renames local
symbols, hashes normalized trees, and anti-unifies literal differences into
helper parameters; broader similarities remain diagnostics.

Near-duplicate tracking defaults to advisory (`HL105`): normalized subtree hashes select
candidates, anti-unification confirms the configured shared-structure threshold across a
configured minimum cluster size, and each occurrence is retained in the local
SQLite diagnostic ledger. It intentionally makes no source changes.

Rule enforcement levels and detection thresholds live in the versioned
[`hyperlinter.config.json`](./hyperlinter.config.json).

Each module also accumulates configured severity weights. A module meeting the
configured threshold emits refactor-blocking `HL106`.

`--fix-private-exports` removes direct named exports with no in-project
consumer when their module already has an in-project dependent. It deliberately
skips possible entrypoints, default exports, re-exports, overloads, and
multi-declaration variable statements; those require human judgement.
