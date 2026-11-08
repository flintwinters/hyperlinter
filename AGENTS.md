# Agent instructions for Hyperlinter

Read [HYPERLINTER.md](./HYPERLINTER.md) before changing this repository. It is
the product manifesto and takes priority over convenience-driven changes.

The runtime requires Node.js 22+ and the N-API SQLite driver (better-sqlite3 13+). The CLI surface should be agent-facing-first.  Prioritize discoverability and usability by coding agents.

The main goal of hyperlinter is to exercise and extract learning from new projects using it so that it can get better.
It is imperative that agents using hyperlinter keep it up to date and add versatile (not project-specific) features when a genuine need arises.

## Mission

Hyperlinter is agent-first: machine-readable JSON is the default CLI interface;
readable text is an explicit option. It gives agents mechanical pressure toward small public APIs,
low coupling, clear boundaries, and maintainable repository structure. Rules
may inspect local code or repository-wide relationships when they provide
useful, deterministic feedback.

## Guardrails

- Prefer small, general structural rules over rules coupled to one application.
- Treat diagnostics, baselines, and enforcement configuration as policy. Do
  not weaken, suppress, or delete them merely to make a change pass.
- Keep Hyperlinter self-hosting: TypeScript source should remain analyzable by
  the same principles it applies to target repositories.
- Preserve the local SQLite evidence ledger as append-only operational data;
  `runtime/` is intentionally ignored and is not source control history.
- Keep target-project policy out of this repository. Local baselines live in
  the target repository's private `.git/hyperlinter/` directory, never in the
  public submodule. Invoke the tool from the target repository root.

## Architecture and current focus

Compiler evidence, authored-file traversal, and function-call analysis have separate
project module boundaries. `StructuralModel` is the language-neutral module contract: the TypeScript
project model owns compiler and reference evidence, and `project/rust` derives the same contract from
tree-sitter syntax and Cargo targets. Rules typed over `StructuralModel` run on every language; others stay
TypeScript-only until a language provides equivalent evidence conservatively. Registered
rules produce diagnostics (including a 12-file direct ownership limit that pressures flat directories, tests included, into hierarchies), module scoring aggregates pressure, and the CLI
records local evidence. CLI discovery (`--help`, `--discover`) exposes static capabilities
without opening target policy or evidence; its catalog owns chronology exclusions.
The CLI never checks remotes for its own updates; only configured semantic embedding may use the network.
Function-call analysis enforces acyclicity and independently configurable source/test generation gaps on resolved local calls;
cycles and their callers have no finite generation. Dynamic dispatch and external callback execution remain outside this evidence.
Dead implementation analysis conservatively roots exports and executable
references; it does not infer application entrypoints.
Public directory indices define module boundaries; persistence owns recorded result contracts.
Regular analysis includes chronolint, which reads pinned first-parent Git snapshots through `history`;
`temporal` owns pure advisory correlation and evidence. Dedicated chronology
and regular runs record provenance; unavailable history is advisory in regular
analysis and fails the dedicated command. Intentional invalid examples are `.fixture` data parsed explicitly by tests. Run `python3 manage.py check` to verify types, self-analysis, and regressions. Cohesion combines internal behavior/state groups with consumer overlap;
keep its quantitative evidence conservative as analysis expands. Preserve
unique diagnostic IDs and reproducible analysis regressions. Use “cluster” for semantic partitions: they are disjoint and exhaustive within a module; average-linkage trees use stable source keys for tie-breaking. Optional semantic
`semantic` owns the implementation inventory, embeddings, clustering evidence and prompts; target-private caches retain vectors. Its
experimental warnings never accumulate enforcement scores. Offline `--semantic-report` exports shared clustering evidence and PNG density contours through `semantic`; optional Python plotting dependencies live in `scripts/requirements-report.txt`. Target-private reference PCA fixes map coordinates; reviewed project axis labels are tied to that basis ID, never universal semantics. Residual reports subtract the reference subspace without renormalizing; enforcement keeps original embeddings. Semantic thresholds
may be tuned after agent examination finds declustering unwarranted. The static
project website publishes from `docs/` on `main`. Author markup and StyleX in
`scripts/site/`; `manage.py site-build` generates the checked HTML and `docs/dist/site.css`.
Never edit compiled assets directly; site checks reject stale output.
Local impact audits aggregate consumer history, namespaced ledger snapshots, and
available independent task outcomes under ignored `artifacts/`. Keep engine
self-checks separate from consumers, preserve unknown provenance, and assess
maintainability using concrete outcomes alongside structural scores.

## First commands

```bash
npm install
npm run hyperlint
npm run baseline
```

For a submodule checkout, run the CLI from the host repository root so it
loads that host's `tsconfig.json` and baseline.
