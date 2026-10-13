# Hyperlinter

Project website: [typie hyperlinter](https://flintwinters.github.io/hyperlinter/).

Hyperlinter is a TypeScript linter for code and repository structure. It uses
the TypeScript compiler graph to report dependency cycles, unused public
exports, and coupling outliers, and also checks local source patterns.

## Add to a project

Add this repository as a submodule at `tools/hyperlint`, then install
Hyperlinter's locked dependencies, including its TypeScript runner:

```bash
git submodule add https://github.com/flintwinters/hyperlinter.git tools/hyperlint
npm --prefix tools/hyperlint ci --include=dev
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts
```

Run the command from the target repository root. It reads that repository's
`tsconfig.json`, persists local run evidence in `tools/hyperlint/runtime/`, and
uses the target repository's local `.git/hyperlinter/baseline.json` for
public-surface and inline-style baselines. This file stays outside Git history
and cannot be committed with project or submodule source. Every
module is also subject to the configured maximum exported-symbol count.
Standalone `.css` files are forbidden; code-native styles are the sole styling system.
Inline JSX styles, HTML `style` attributes, and HTML `<style>` blocks are also rejected. HTML templates beside or below configured TypeScript module directories share this policy; generated and dependency trees are excluded. Existing instances can be recorded in a
local baseline so the check blocks new instances.
The root `AGENTS.md` is capped at 150 lines so it remains a broad-strokes,
semantic entrypoint for agents rather than an all-encompassing project map.
An architectural module is the source-owning directory: it must have exactly
one `index.*` public entrypoint, and every other file in that directory is
private to that module. Internal files may use TypeScript exports for internal
imports, but other modules must import the directory index. An entrypoint file
with one top-level declaration and one export is rejected as an unnecessary
architectural boundary.
Directory modules may own at most 12 source files from the configured TypeScript
project, including their entrypoint. Descendant directories own their files
separately; styles, generated files and tests receive no filename exemptions.
The versioned `moduleFiles.maximum` policy controls this limit (`HL117`).

## Optional hardcoded-color file cap

`HL118` limits the number of source files defining literal CSS colors across a
target project. It is disabled by default. Enable it with a versioned
`hyperlinter.project.json` in the target repository root:

```json
{
  "colorFiles": {
    "maximum": 3,
    "severity": "error",
    "sourceRoots": ["src"]
  }
}
```

`maximum` is an inclusive, non-negative file budget. Severity defaults to `error`
and source roots default to `["."]`, covering the configured TypeScript project.
Roots are normalized project-relative directories, not globs; descendant files
count together. Declaration files are excluded. Missing policy disables the
rule; malformed policy fails rather than silently disabling enforcement.

The TypeScript AST supplies string/template expressions and JSX/SVG attribute
values; a CSS parser recognizes hex, named and functional colors, including
compound shadows, gradients, keyframes and embedded stylesheets. Comments,
imports, type declarations, URLs, CSS string contents and neutral keywords
such as `transparent` and `currentColor` do not count. Each file counts once,
regardless of the number of literals. Referencing an imported token does not
count. Literal definitions in arrays, stored defaults and seed code count too.

This is a concentration budget, not token-provenance analysis: numeric channel
calculations, string concatenation and arbitrary runtime-generated colors are
not exhaustively traced. Template interpolations use numeric placeholders to
recognize authored color functions without executing code. Standalone strings
that are valid color names count even if the application uses them as labels.

`--check-colors` inventories contributing files and checks the cap;
`--format=json` includes literal values and source lines. Both normal analysis
and `--check-styles` enforce the policy. When over budget, every contributing
file receives a diagnostic. To migrate, freeze the current count and lower the
budget as definitions move into shared owners; do not increase it to admit a
new component. Target policy belongs in the target repository, not this engine.

## Commands

```bash
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --write-baseline
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --write-inline-style-baseline
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --check-styles
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --check-colors
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --source-budget check
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --fix-private-exports
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --history
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --format=json
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts --fix
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

Website verification is repeatable through `manage.py`: `site-preview` audits
320px, 390px, 768px, and 1440px CSS viewports with page JavaScript disabled,
checks clipping, install visibility, text contrast, keyboard skip navigation,
and the optional copy button's real clipboard
contents, and saves full-page screenshots in
`runtime/site-preview/`. It requires Chromium and Python `websocket-client`.
`site-install` exercises the published commands against a local submodule clone
and installs dependencies with npm; it requires registry access. `site-live`
compares deployed HTML/assets/sitemap with the checkout and verifies custom 404
behavior and the origin robots policy. Metadata checks do not establish indexing,
ranking, conversion, or real-user performance.
