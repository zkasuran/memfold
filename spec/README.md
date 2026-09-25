# memfold

One common memory for every AI coding tool and agent framework.

memfold is an open specification and reference implementation for a tool-neutral memory system.
It stores each durable fact, preference, decision or note once as a **Memory Record**, then projects
that record into whatever native format each tool reads. A rule you write once shows up in Claude
Code, Cursor, Codex, Copilot and the rest, in the file and shape each of them expects, without you
copying it by hand.

## The problem

AI coding tools each invented their own place to keep standing instructions and learned context. One
2026 survey counted 21 distinct instruction-file paths across 18 tool families and only 7 of the 18
publish any rule for which file wins when several apply. The pain that grows out of that fragmentation
is documented, not anecdotal. The problem taxonomy this project targets (see
`research/11-problems.md`, problems P1 to P14):

- **Fragmentation (P1).** Every tool has its own filename, location and format. There is no canonical
  place, so each agent gets a different briefing.
- **Duplication (P2).** The same facts get copied into `CLAUDE.md`, `AGENTS.md`, `.cursor/rules` and
  more. One logical edit becomes N hand edits and the cost scales with tools times conventions times
  contributors.
- **Drift and staleness (P3).** Copies diverge. A June 2026 study measured stale code references in
  23% of a 356-repo sample and named it "context rot". A confidently wrong rule is worse than none.
- **No cross-tool memory (P7).** Memory is siloed by design. Switching tools or machines resets
  accumulated knowledge because it does not follow you.
- **Secrets leakage (P6).** Because rules files are meant to be committed, they are the wrong place
  for a credential, yet agents write config there. A population-scale scan found over 1,230 hardcoded
  keys and tokens across AI instruction files in public repos. There is an open report of an agent
  committing keys despite a `CLAUDE.md` that forbade it.

Related problems the model addresses: precedence and scope confusion (P4), context bloat from loading
whole files every turn (P5), no versioning or provenance (P8), no merge story for conflicting rules
(P9), the team-vs-personal wrong-layer problem (P10), manual maintenance and sprawl (P11) and unreliable
auto memory (P12).

## The model

The canonical unit is the Memory Record, defined by `spec/memory-record.schema.json` and specified in
`spec/protocol.md`. A record is one durable item of memory with a stable identity, a type, a scope, a
body, provenance and merge metadata. Records live on disk as YAML frontmatter plus a markdown body, in
a git-diffable directory beside your code and are mirrored into SQLite for query. Merge is
deterministic: a hybrid logical clock drives last-writer-wins for scalar fields, tags and links are
CRDT OR-sets and deletes are tombstones. Every write passes a secret gate before it can touch disk.

## Three interop surfaces

memfold reaches tools three ways, from one store. A tool is served by whichever surface it supports,
and the file compiler is the floor that reaches everything.

1. **Compiled files.** The store compiles records into each tool's native instruction files
   (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, `.windsurf/rules/*.md`,
   `.github/copilot-instructions.md` and the long tail). This is the widest-reach surface and the only
   one that works for tools that are not MCP clients at all. See `spec/adapters.md`.
2. **MCP.** A Model Context Protocol server exposes reads and writes as tools (`memory_search`,
   `memory_write`, `memory_get`, `memory_list`, `memory_forget`), with an optional resource mirror for
   clients that read resources. Tools are the primary surface because every MCP client implements
   tools while resource support is inconsistent. See `spec/mcp.md`.
3. **Daemon REST.** A local daemon serves an HTTP API (health, memories CRUD, search) plus a git op-log,
   for editors, scripts and frameworks that speak HTTP rather than MCP. See `spec/rest.md`.

## Specification map

| File | Contents |
|---|---|
| `spec/protocol.md` | Normative spec: record fields, scope and precedence, merge and sync, on-disk layout, secret gate. |
| `spec/mcp.md` | MCP tool contract and optional resources. |
| `spec/rest.md` | Daemon REST contract with request and response examples. |
| `spec/adapters.md` | Per-tool matrix: native paths, formats, load behavior, read and write notes. |
| `spec/memory-record.schema.json` | JSON Schema (2020-12) for the Memory Record. |
| `conformance/` | Example vectors and a vitest suite that any implementation must pass. |

## Conformance

`conformance/vectors/` holds example records (valid ones for each type and scope, plus invalid ones)
indexed by `conformance/vectors/index.json`. `conformance/conformance.test.ts` validates every vector
against `@memfold/core` and checks that valid records round-trip losslessly through on-disk
serialization. Run it with `./node_modules/.bin/vitest run --config conformance/vitest.config.ts`.

## Status and licence

Draft specification, `schema_version: 1`. The reference implementation lives in `packages/`.

Everything under `spec/` and `conformance/` is licensed Apache-2.0.

SPDX-License-Identifier: Apache-2.0
