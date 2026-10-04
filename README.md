# Hyperlinter

Project website: [typie hyperlinter](https://flintwinters.github.io/hyperlinter/).

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

Dead implementation detection (`HL114`, error) reports unreachable top-level
functions and variables initialized with functions, including recursive groups
and chains used only by dead implementations. Exports and references outside
these candidate implementations are roots; callback references and shorthand
properties count as uses. This is conservative symbol reachability, not proof
of runtime execution. It does not detect dead exported APIs, whole modules,
class members, or code accessed through runtime string lookup/eval. No deletion
is applied automatically.

Diagnostic IDs distinguish module entrypoints (`HL108`), agent instruction
length (`HL112`), unused public exports (`HL102`), and public-surface growth
(`HL113`). Historical ledger entries retain their original IDs.

Run `python3 manage.py check` for typechecking and regression tests.

Module cohesion (`HL115`, info) prompts the coder to refactor when **both**
configured signals cross their thresholds:

- Separated export-pair ratio **>= 0.5**: the fraction of pairs belonging to
  different implementation groups. Exports join groups when their reachable
  in-module behavior/state declarations intersect; merging is transitive.
- Mean consumer overlap **<= 0.2**: the unweighted mean Jaccard similarity
  (intersection / union) of external module consumer sets across group pairs.

At least four behavior/state exports and two exports per group are required.
Every group must have known consumers. Types, literal constants, and type-only
references do not connect implementations. Re-exports are resolved to their
underlying symbols; facade exports implemented outside the directory are
excluded. Consumers include all modules in the configured TypeScript project,
including tests; module-level consumption is deliberately coarse.

Thresholds and severity live in `hyperlinter.config.json` under `cohesion` and
`rules.moduleCohesion`. Diagnostics show measured values, thresholds, groups,
consumers, and refactoring instructions. The rule participates in existing
module scoring; no automatic split is performed. These defaults are initial
heuristics, not empirically calibrated proof of unrelated responsibilities.

Experimental semantic grouping (`HL116`, warning) is optional and never contributes
to blocking module scores. Set `semantic.enabled` to `true` in Hyperlinter's
configuration to refresh and examine embeddings during each analysis, or run
`npm run hyperlint -- --build-embeddings` for an explicit index build.
`OPENROUTER_API_KEY` must be present in the environment for every embedding build
(including warm-cache builds); ordinary checks need no key. An explicit build
fails if indexing fails; optional analysis reports an availability warning.

Function source is sent to OpenRouter's [embedding endpoint](https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings),
using `openai/text-embedding-3-small` by default. All current implementations
are indexed, including private functions, callbacks, methods, accessors, and
constructors; declaration-only signatures are excluded. “Active” means present
in the current compiler project, not proven reachable at runtime. The private
`.git/hyperlinter/semantic-embeddings.json` cache records the current inventory,
reuses content hashes, re-embeds changed functions or model changes, and prunes
removed functions on each successful build. Failed builds leave the previous
index intact and do not analyze stale embeddings. Full function text is sent;
provider size limits cause an availability warning rather than silent truncation.

Within each module, deterministic complete-link assignment groups functions
whose pairwise cosine distances are at most `maximumWithinClusterDistance`
(default **0.25**). A warning requires two groups of at least
`minimumClusterFunctions` (**8 each**) with every cross-group distance at least
`minimumClusterDistance` (**0.8**, on a 0–2 scale). These lax defaults are noisy,
model-dependent heuristics. Add threshold overrides to the `semantic` object in
`hyperlinter.config.json`; defaults are defined once in `src/config/SemanticConfig.ts`.
The prompt requests agent examination, not automatic
refactoring: if declustering is unwarranted, the agent should probably adjust
these experimental thresholds in Hyperlinter and explain why. The prompt also
requests investigation of applicable improvements to embedding context, clustering,
distance/count thresholds, and structural corroboration, supported by the triggering
evidence and regression tests for reproducible analysis failures. This exception
applies only to semantic advice; existing enforcement remains policy.

## Project website

GitHub Pages serves the static `docs/` directory from `main`; no website build
or API key is needed. Keep the canonical URL, sitemap, and structured data aligned
with the deployed address. Project-site `robots.txt` cannot control crawling at
the origin root, so the page uses indexing metadata and a discoverable sitemap.
`python3 manage.py check` verifies the page metadata and internal navigation along
with the TypeScript project.
