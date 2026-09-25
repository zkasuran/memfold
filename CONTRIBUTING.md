# Contributing to memfold

Thanks for helping build memfold. This guide covers the licence terms you agree to when you
contribute, how the repository is laid out and how to run the checks locally.

## Licence and contributor terms

memfold is source-available, not OSI "open source". Different parts carry different licences:

- **Apache-2.0**: the specification (`spec/`), the conformance suite (`conformance/`) and the
  `@memfold/core`, `@memfold/adapters`, `@memfold/mcp` and `@memfold/sdk` packages.
- **FSL-1.1-ALv2**: the `@memfold/daemon` package and the `memfold` CLI. This permits any use except a
  Competing Use and converts to Apache-2.0 two years after each release.

By opening a pull request you agree that your contribution is licensed under the licence that already
applies to the files you change, and you grant the project the right to relicense the FSL-covered
parts on the future Apache-2.0 grant date. Keep new files under the licence of the directory they live
in and carry the matching `SPDX-License-Identifier` header where the surrounding files do. Do not add
code under a licence that conflicts with these terms.

If your employer owns your work, make sure you have the authority to contribute it before you open the
pull request.

## Repository layout

- `spec/` and `conformance/` define the protocol and the tests any implementation must pass. Treat
  the spec as normative and change it deliberately.
- `packages/` holds the TypeScript workspace: `core`, `adapters`, `mcp`, `daemon`, `sdk` and the
  `cli`.
- `sdks/` holds the non-TypeScript clients (`python`, `go`, `rust`), which target the daemon REST
  contract.
- `docs/` is the prose documentation. `index.html` is the landing page.

## Local development

The workspace uses pnpm. Node 22 is the supported version.

```sh
pnpm install
pnpm typecheck   # tsc across the workspace
pnpm test        # vitest, the package and conformance suites
pnpm lint        # biome check
pnpm format      # biome format --write
pnpm build       # build every package
```

Continuous integration runs `pnpm typecheck`, `pnpm test` and `pnpm lint` on every push and pull
request. Run all three locally before you open a pull request, and add or update tests for any
behaviour you change. The conformance suite has its own config:

```sh
./node_modules/.bin/vitest run --config conformance/vitest.config.ts
```

## Pull request checklist

- Tests pass and cover the change.
- Types check and the linter is clean.
- Any protocol change is reflected in `spec/` and, where relevant, in the conformance vectors.
- No secret, key or token is committed. The store's secret gate blocks these on write; do not work
  around it.
- Prose in docs and comments is plain and direct.

## Reporting security issues

If you find a way to leak a secret past the gate, to poison a store through an imported rules file or
to reach a daemon without auth, report it privately rather than opening a public issue.
