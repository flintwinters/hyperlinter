# Hyperlinter

Hyperlinter is a repository-scale TypeScript architecture linter. It uses the
TypeScript compiler graph to report dependency cycles, unused public exports,
and coupling outliers. It is intended to complement local ESLint rules, not
replace them.

## Add to a project

Add this repository as a submodule at `tools/hyperlint`, then install the host
project's dependencies (or install this package's dependencies independently):

```bash
git submodule add git@github.com:flintwinters/hyperlinter.git tools/hyperlint
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
```

The evidence ledger is intentionally local and ignored by Git. Baselines are
target-project policy and should be reviewed with the target project's code.
