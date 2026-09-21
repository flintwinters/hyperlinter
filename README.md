# Hyperlinter

Hyperlinter is a repository-scale TypeScript architecture linter. It uses the
TypeScript compiler graph to report dependency cycles, unused public exports,
and coupling outliers. It is intended to complement local ESLint rules, not
replace them.

## Add to a project

Add this repository as a submodule at `tools/hyperlint`, then install the host
project's dependencies (or install this package's dependencies independently):

```bash
git submodule add git@africa.local:everyone/nnj/hyperlinter.git tools/hyperlint
npx tsx tools/hyperlint/src/cli.ts
```

Run the command from the target repository root. It reads that repository's
`tsconfig.json`, persists local run evidence in `tools/hyperlint/runtime/`, and
uses `tools/hyperlint/baseline.json` for public-surface trend checks. Every
module is also subject to the configured maximum exported-symbol count.
Standalone `.css` files are forbidden; code-native styles are the sole styling system.
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
npx tsx tools/hyperlint/src/cli.ts --fix-private-exports
npx tsx tools/hyperlint/src/cli.ts --history
npx tsx tools/hyperlint/src/cli.ts --format=json
npx tsx tools/hyperlint/src/cli.ts --fix
npx tsx tools/hyperlint/src/cli.ts --source-budget check
```

The evidence ledger is intentionally local and ignored by Git. Baselines are
target-project policy and should be reviewed with the target project's code.

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

Projects may opt into a source-line budget by adding a `source-line-budget.json`
at their root and invoking `--source-budget check`, `advance`, or
`advance-if-pending`. Its checkpoints, source directories, and reductions are
target-project policy; Hyperlinter supplies only the reusable enforcement.

Each module also accumulates configured severity weights. A module meeting the
configured threshold emits refactor-blocking `HL106`.

`--fix-private-exports` removes direct named exports with no in-project
consumer when their module already has an in-project dependent. It deliberately
skips possible entrypoints, default exports, re-exports, overloads, and
multi-declaration variable statements; those require human judgement.
