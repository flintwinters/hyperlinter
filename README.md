<p align="center">
  <img src="docs/favicon.svg" alt="Hyperlinter logo" width="88">
</p>

# Hyperlinter

Hyperlinter is a structural linter for code written by coding agents. Agents tend to produce code that works but slowly decays: public APIs grow, modules couple, logic gets duplicated, and directories go flat. Hyperlinter makes that drift visible and fails the build on it, so the easiest path for an agent is also the clean one.

It checks TypeScript and Rust repositories for dependency cycles, unused or oversized public APIs, imports that bypass a module's entrypoint, overfull directories, and coupling outliers. In TypeScript it also checks function call cycles, dead code, and duplicated logic. Output is JSON by default, for agents; `--format=text` is for people. `--help` lists every command.

Baselines live in the target repository's `.git/hyperlinter/`, outside version control, so the agent being constrained cannot quietly loosen its own policy.

The append-only audit ledger also lives there as `hyperlint.sqlite` (following Git metadata for worktrees and submodules). Closing SQLite cleans up its journal files. An existing `runtime/hyperlint.sqlite` migrates without copying on the next run, and its directory is removed only if empty. Migration waits while SQLite sidecars exist; filesystems that cannot hard-link to the Git directory retain the legacy location. Existing destination ledgers and unrelated runtime files are never removed.

```bash
git submodule add https://github.com/flintwinters/hyperlinter.git tools/hyperlint
npm --prefix tools/hyperlint ci --include=dev
./tools/hyperlint/node_modules/.bin/tsx tools/hyperlint/src/cli.ts
```

Run it from the target repository root. To update, run `git -C tools/hyperlint pull --ff-only` and reinstall.

Built with TypeScript, the TypeScript compiler API, tree-sitter, and SQLite; requires Node.js 22+. See [HYPERLINTER.md](HYPERLINTER.md) for the design principles.
