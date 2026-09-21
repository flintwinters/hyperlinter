## Hyperlinter paradigm

The goal is to make an AI coding agent operate inside a **procedurally constrained codebase** where poor local decisions are detected, accumulated, and corrected by tooling rather than by prompt discipline alone.

The system should assume that coding models will often produce code that is valid but mediocre: too much coupling, oversized public APIs, duplicated logic, weak boundaries, unnecessary exports, ad hoc constants, and gradual architectural drift. The hyperlinter exists to make those failure modes mechanically visible.

### Core principles

* **Use ordinary ESLint for cheap local rules.** Magic literals, naming, unsafe patterns, simple AST checks, and local type-aware rules do not belong in the expensive hyperlinter.
* **Use the hyperlinter only for repository-scale reasoning.** It should analyze dependency graphs, symbol visibility, module APIs, cross-file relationships, architectural boundaries, and accumulated structural smells.
* **Prefer simple primitive rules over architecture-specific rules.** Good rules should generalize across frontends, backends, CLIs, libraries, workers, and monorepos.
* **Create pressure, not bureaucracy.** The objective is to make the easiest path for the coding agent also the cleanest path.
* **Prefer privacy and small APIs.** Public surface should stay small; implementation details should remain private unless external use justifies exposure.
* **Measure trends and concentrations of smells.** Individual weak signals may be advisory. Accumulated or concentrated structural problems can cross a threshold and trigger a refactor.
* **Use deterministic fixes where safe.** Mechanical problems should be automatically repaired. Ambiguous architectural changes should produce diagnostics for the coding agent to resolve.
* **Do not let the coding agent weaken enforcement.** Linter configuration, architectural policy, suppressions, and CI gates should not be casually editable by the same agent being constrained.

### Self-hosting feedback loop

Write the hyperlinter itself in **TypeScript**, so it is analyzed by the same compiler APIs, ESLint rules, and structural constraints that it applies to the rest of the codebase. This creates a compounding feedback loop: improvements to the hyperlinter can immediately improve the quality of both application code and future hyperlinter development, while the hyperlinter simultaneously constrains its own architecture and prevents its rule engine from degrading as it grows.

### Intended workflow

```text
coding agent changes code
→ ESLint catches cheap/local problems
→ hyperlinter analyzes repository structure
→ smells and violations are recorded
→ safe fixes are applied automatically
→ accumulated structural debt can trigger refactoring
→ tests and CI validate the result
```

The objective is not to make the linter “understand good architecture” in the abstract.

The objective is to build a small number of **high-leverage structural constraints and metrics** that continuously bias AI-generated code toward encapsulation, low coupling, narrow APIs, clear boundaries, and maintainable structure.
