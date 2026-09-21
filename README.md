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
uses `tools/hyperlint/baseline.json` for public-surface trend checks.

## Commands

```bash
npx tsx tools/hyperlint/src/cli.ts
npx tsx tools/hyperlint/src/cli.ts --write-baseline
npx tsx tools/hyperlint/src/cli.ts --history
npx tsx tools/hyperlint/src/cli.ts --format=json
npx tsx tools/hyperlint/src/cli.ts --fix
```

The evidence ledger is intentionally local and ignored by Git. Baselines are
target-project policy and should be reviewed with the target project's code.

`--fix` extracts eligible exact AST clones: non-exported, synchronous top-level
functions with the configured minimum meaningful AST nodes. Detection alpha-renames local
symbols, hashes normalized trees, and anti-unifies literal differences into
helper parameters; broader similarities remain diagnostics.

Near-duplicate tracking is advisory (`HL105`): normalized subtree hashes select
candidates, anti-unification confirms at least 90% shared structure across a
cluster of three or more methods, and each occurrence is retained in the local
SQLite diagnostic ledger. It intentionally makes no source changes.

Clone thresholds live in the versioned [`hyperlinter.config.json`](./hyperlinter.config.json).
