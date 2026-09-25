# memfold

One common memory for every AI coding tool and agent framework.

memfold keeps your rules and your learned memory in a single canonical, versioned, local-first
store, then projects that store into whatever each tool reads. Write a rule once and it shows up in
Claude Code, Cursor, Copilot, Codex, Gemini and the rest, in the file and shape each of them expects.
Read and write the same memory live over an MCP server, or over a local REST daemon. One edit
propagates everywhere, with a defined winner instead of an arbitrary one.

- **Compile** the store out to every tool's native rules file, merging into hand-written text
  instead of clobbering it.
- **Serve** the same memory over MCP so any MCP client can search, write and forget live.
- **Sync** through a local daemon with a REST API and a git-backed append-only op-log.

## Status

memfold is in active development and the specification is a draft at `schema_version: 1`. What is
built and tested today: the TypeScript packages `@memfold/core`, `@memfold/adapters`, `@memfold/mcp`,
`@memfold/daemon` and `@memfold/sdk`, with **44 passing tests**. The `memfold` command-line tool and
the Python, Go and Rust clients are in progress; where this README shows a `memfold ...` command, the
same operation runs today through the SDK, the `memfold-mcp` server or the `memfold-daemon`, all shown
below.

## The problem

AI coding tools each invented their own place to keep standing instructions and learned context. A
2026 survey counted 21 distinct instruction-file paths across 18 tool families, and found only 7 of
the 18 publish any rule for which file wins when several apply. The pain that grows out of that is
documented, not anecdotal (see `research/11-problems.md`):

- **Fragmentation.** Every tool has its own filename, location and format, so each agent gets a
  different briefing.
- **Duplication.** The same facts get copied into `CLAUDE.md`, `AGENTS.md`, `.cursor/rules` and more.
  One logical edit becomes many hand edits.
- **Drift.** Copies diverge. A June 2026 study measured stale code references in 23% of a 356-repo
  sample and named it "context rot". A confidently wrong rule is worse than none.
- **No cross-tool memory.** Memory is siloed by design, so switching tools or machines resets what
  the agent had learned.
- **Secret leakage.** Rules files are meant to be committed, which makes them the wrong place for a
  credential, yet agents write config there. A population-scale scan found over 1,230 hardcoded keys
  and tokens across AI instruction files in public repositories.

memfold attacks the root, which is having many files with no single source of truth, rather than
patching each symptom.

## How it works

The canonical unit is the **Memory Record**: one durable fact, preference, decision, convention,
episode, task or entity, with a stable identity, a scope, a body, provenance and merge metadata.
Records live on disk as YAML frontmatter plus a markdown body in a git-diffable directory, and are
mirrored into SQLite for query. See `spec/protocol.md` for the normative model and
`spec/memory-record.schema.json` for the schema.

memfold reaches tools three ways from that one store:

1. **Compiled files.** The store renders records into each tool's native instruction files. Files a
   human also edits (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `GEMINI.md`,
   `CONVENTIONS.md`) are written inside a fenced managed block, so hand-authored prose around the
   block survives every recompile. Dedicated memfold files (Cursor `.mdc`, Windsurf `.md`, Cline
   `.md`) are owned in full.
2. **MCP.** A Model Context Protocol server exposes reads and writes as tools (`memory_search`,
   `memory_write`, `memory_get`, `memory_list`, `memory_forget`), with an optional `memory://`
   resource mirror. Tools are the primary surface because every MCP client implements tools while
   resource support is inconsistent. See `spec/mcp.md`.
3. **Daemon REST.** A local daemon serves an HTTP API over the store plus a git-syncable op-log, for
   editors, scripts and frameworks that speak HTTP rather than MCP.

Under the surfaces sit the parts that make the store trustworthy: hybrid retrieval (BM25 full text
fused with vector search over `sqlite-vec` by reciprocal rank fusion), a hybrid logical clock that
drives deterministic last-writer-wins merge across machines, four scopes with explicit precedence,
salience and decay for ranking, per-record provenance and a pre-write secret gate that refuses to
persist a detected credential.

### On-disk layout

A memfold store is a directory. A repository carries a committed store for shared memory, and a
machine keeps a separate uncommitted store for `global` and personal records so nothing private lands
in version control.

```
.memory/
  records/<id>.md     one file per record: YAML frontmatter + markdown body
  oplog.jsonl         append-only operation log (the sync and audit unit)
  index.db            SQLite mirror (FTS5 + vectors); a rebuildable cache, gitignored
```

The record file name is the record id, so the git history of one file is the history of one memory.
The op-log is append-only, so git merges union new lines rather than conflict. The SQLite mirror is a
derived cache and can be rebuilt from the records and the log alone.

## Quickstart

The intended front door is the CLI:

```sh
npx memfold init                                   # create a store in this repo
memfold add "API errors return { error: { code, message } }" --type convention --scope project
memfold compile                                    # write every detected tool's native files
memfold serve mcp                                  # expose the store to MCP clients over stdio
memfold serve daemon                               # or run the local REST daemon
```

The `memfold` CLI is in progress. Today the same four steps run through the packages that ship now:

```sh
# 1. Add and search memory from your own code (embedded SQLite store)
pnpm add @memfold/sdk
```

```ts
import { Memfold } from '@memfold/sdk'

const mem = new Memfold('./.memory/index.db')
await mem.add({
  type: 'convention',
  scope: 'project',
  body: 'API errors return { error: { code, message } }; never leak stack traces.',
})
const hits = await mem.search('how do handlers return errors')
console.log(hits[0]?.record.body)
await mem.close()
```

```sh
# 2. Serve that store over MCP (stdio). Point any MCP client at this binary.
MEMFOLD_DB=./.memory/index.db npx memfold-mcp

# 3. Or run the local REST daemon (loopback, set a token before exposing it)
MEMFOLD_DB=./.memory/index.db MEMFOLD_TOKEN=$(openssl rand -hex 16) npx memfold-daemon
```

Compiling records out to tool files runs through `@memfold/adapters` today (`detectInstalled`,
`compileAll`, `writeCompiled`); see [docs/adapters.md](docs/adapters.md).

## Packages

| Package | What it is | Licence |
|---|---|---|
| `@memfold/core` | Record model, local SQLite store (FTS5 + `sqlite-vec`), hybrid retrieval, HLC merge, secret gate | Apache-2.0 |
| `@memfold/adapters` | Read and compile every tool's native rules files, with managed-block merge | Apache-2.0 |
| `@memfold/mcp` | MCP server exposing the store as tools and optional resources | Apache-2.0 |
| `@memfold/sdk` | TypeScript SDK: embedded and remote, plus LangGraph and Vercel AI adapters | Apache-2.0 |
| `@memfold/daemon` | Local REST daemon and git-backed append-only op-log | FSL-1.1-ALv2 |
| `memfold` (CLI) | Command-line tool over the packages above | FSL-1.1-ALv2 |

The specification under `spec/` and the conformance suite under `conformance/` are Apache-2.0, so
anyone can implement the protocol and interoperate.

## Usage

### Compile to tool files

`@memfold/adapters` detects which tools a repo is configured for and writes each one's native files.
It runs the secret gate before touching disk and merges managed blocks so hand-written text survives.

```ts
import { detectInstalled, compileAll, writeCompiled } from '@memfold/adapters'

const root = process.cwd()
const adapters = await detectInstalled(root)          // e.g. Claude Code, Cursor, Copilot
const files = compileAll(records, adapters, root)
await writeCompiled(files)                            // creates dirs, merges blocks, blocks secrets
```

memfold ships eight adapters: `agents-md`, `claude-code`, `cursor`, `windsurf`, `copilot`, `gemini`,
`cline` and `aider`. The full per-tool matrix is in [docs/adapters.md](docs/adapters.md).

### MCP

The MCP server exposes five tools. Every read and write is a tool, because tools are the one
primitive every MCP client implements. A client spawns the `memfold-mcp` binary over stdio:

```json
{
  "mcpServers": {
    "memfold": { "command": "memfold-mcp", "env": { "MEMFOLD_DB": "/path/to/index.db" } }
  }
}
```

Tools: `memory_search`, `memory_write`, `memory_get`, `memory_list` and `memory_forget`. Local stdio
is unauthenticated by design; a network-exposed endpoint must add auth. See [docs/mcp.md](docs/mcp.md).

### Daemon REST

The daemon puts a small HTTP API in front of the store and mirrors every write to the op-log. It
binds to loopback and is unauthenticated unless `MEMFOLD_TOKEN` is set.

```sh
curl -s localhost:7077/health

curl -s localhost:7077/memories -H 'content-type: application/json' -d '{
  "type": "fact", "scope": "project",
  "body": "The build runs on Node 22",
  "provenance": { "source": "user" }
}'

curl -s localhost:7077/search -H 'content-type: application/json' -d '{ "query": "node version" }'
```

Routes: `GET /health`, `POST /memories`, `GET /memories`, `GET /memories/:id`, `PATCH /memories/:id`,
`DELETE /memories/:id` (tombstone) and `POST /search`. See [docs/daemon-rest.md](docs/daemon-rest.md).

### SDK

One TypeScript surface, two backends. Start embedded and move to the daemon later without changing
call sites, because the method names are the same either way.

```ts
import { Memfold, MemfoldClient } from '@memfold/sdk'

const local = new Memfold('./.memory/index.db')                 // in-process
const remote = new MemfoldClient({ baseUrl: 'http://127.0.0.1:7077', token })  // over the daemon

for (const mem of [local, remote]) {
  await mem.add({ type: 'preference', scope: 'global', body: 'Indent with tabs' })
  const hits = await mem.search('indentation')
}
```

The SDK also ships a LangGraph `BaseStore`-shaped adapter (`MemfoldLangGraphStore`) and a Vercel AI
SDK chat-message store (`MemfoldChatStore`), neither of which imports the host framework, so they stay
version-agnostic. See [docs/sdk.md](docs/sdk.md).

The Python, Go and Rust clients are in progress. The Go package defines the wire types
(`sdks/go/types.go`) and the Rust and Python crates are scaffolded. All three target the same daemon
REST contract as the TypeScript `MemfoldClient`.

## Alignment with AGENTS.md and MCP

memfold does not compete with `AGENTS.md` or MCP. It feeds them. `AGENTS.md` is one of the compile
targets, written as a managed block so your hand-authored guidance stays intact. MCP is a first-class
serving surface, built tools-first so tool-only clients keep the full read and write surface. memfold
is the single source the two are generated from, which is the piece neither of them provides on its
own.

## Licensing

memfold is **source-available**, licensed by component:

- **Apache-2.0** for the specification, the conformance suite, `@memfold/core`, `@memfold/adapters`,
  `@memfold/mcp` and `@memfold/sdk`. Implement the protocol and build clients freely.
- **FSL-1.1-ALv2** (Functional Source License, Apache-2.0 future) for `@memfold/daemon` and the
  `memfold` CLI. Any use is permitted except a Competing Use, and each release converts to Apache-2.0
  two years after it ships.

FSL is not an OSI-approved license, so memfold is described as source-available (or Fair Source), not
"open source". Keeping the spec and the client SDKs Apache-2.0 means anyone can implement memfold and
interoperate. Full terms are in [`LICENSE`](LICENSE) and [`LICENSES/`](LICENSES).

## Documentation and specification

- Docs: [`docs/`](docs/) covers [getting started](docs/getting-started.md),
  [concepts](docs/concepts.md), the [CLI](docs/cli.md), [adapters](docs/adapters.md),
  [MCP](docs/mcp.md), the [daemon REST API](docs/daemon-rest.md), the [SDK](docs/sdk.md) and an
  [FAQ](docs/faq.md).
- Specification: [`spec/`](spec/) holds the normative protocol, the record schema and the MCP
  contract. Conformance vectors and a test suite are in [`conformance/`](conformance/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are welcome under the project's source-available
licences and require agreeing to the contributor terms noted there.

