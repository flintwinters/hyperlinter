# Agent instructions for Hyperlinter

Read [HYPERLINTER.md](./HYPERLINTER.md) before changing this repository. It is
the product manifesto and takes priority over convenience-driven changes.

## Mission

Hyperlinter gives coding agents mechanical pressure toward small public APIs,
low coupling, clear boundaries, and maintainable repository structure. It is
not a replacement for ESLint: cheap local checks belong in ESLint; compiler- or
repository-scale relationships belong here.

## Guardrails

- Prefer small, general structural rules over rules coupled to one application.
- Treat diagnostics, baselines, and enforcement configuration as policy. Do
  not weaken, suppress, or delete them merely to make a change pass.
- Keep Hyperlinter self-hosting: TypeScript source should remain analyzable by
  the same principles it applies to target repositories.
- Preserve the local SQLite evidence ledger as append-only operational data;
  `runtime/` is intentionally ignored and is not source control history.
- Keep target-project policy out of this repository. A project owns its own
  baseline and invokes this tool from its repository root.

## First commands

```bash
npm install
npm run hyperlint
npm run baseline
```

For a submodule checkout, run the CLI from the host repository root so it
loads that host's `tsconfig.json` and baseline.
