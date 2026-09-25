# memfold

One common memory for every AI coding tool and agent framework.

[![CI](https://github.com/zkasuran/memfold/actions/workflows/ci.yml/badge.svg)](https://github.com/zkasuran/memfold/actions/workflows/ci.yml)
&nbsp;Source-available (Apache-2.0 for the spec and SDKs, FSL-1.1 for the daemon and CLI)

You keep your project's rules and decisions in one place. memfold stores them in a local
database and projects them into whatever AI coding tool you happen to be using: it compiles
them into each tool's native rules file, serves them live over an MCP server, and exposes them
through a local REST daemon with SDKs for four languages. Write a fact once, and Claude Code,
Cursor, Copilot, Codex, Gemini, Cline and Aider all read the same thing.

## The problem

Every AI coding tool reads from its own file. Claude Code reads `CLAUDE.md`. Codex and a growing
list of tools read `AGENTS.md`. Cursor reads `.cursor/rules/*.mdc`, Copilot reads
`.github/instructions`, Gemini reads `GEMINI.md`, Cline reads `.clinerules`, Aider reads
`CONVENTIONS.md`. There are more than twenty of these conventions.

So you end up copying the same rules into each file by hand. They drift apart the moment one is
edited. Nothing carries across when you switch tools. And because these files get committed,
secrets pasted into them leak into git history. memfold removes the copying, the drift, and the
leaks by keeping one source of truth and generating the rest.

## Try it

A real session, start to finish. No setup beyond Node 20+.

```console
$ npx memfold init
memfold initialised
  store    ./.memfold/memory.db
  scope    project
  node id  96631630
  vectors  on
  tools    none detected

$ memfold add "Use tabs for indentation, width 4" --type preference
remembered 01M3BK22WVEJ7BHX5XWXA8QA75 (preference/project)

$ memfold add "We chose Postgres over MySQL for JSONB and partial indexes" \
    --type decision --title "Database choice"
remembered 01M3BK23WZ6KKQPEVVFCCQQTFV (decision/project)

$ memfold search "which database"
0.025  decision/project    01M3BK23WZ6KKQPEVVFCCQQTFV  Database choice
0.012  preference/project  01M3BK22WVEJ7BHX5XWXA8QA75  Use tabs for indentation, width 4

$ memfold compile --all
compiled
  AGENTS.md      ./AGENTS.md
  Claude Code    ./CLAUDE.md
  Cursor         ./.cursor/rules/memfold.mdc
  Windsurf       ./.windsurf/rules/memfold.md
  GitHub Copilot ./.github/copilot-instructions.md
  Gemini CLI     ./GEMINI.md
  Cline          ./.clinerules/memfold.md
  Aider          ./CONVENTIONS.md
```

That last step wrote eight files. Here is the `AGENTS.md` it produced. The content sits between
markers, so anything you write outside them survives the next `compile`:

```markdown
<!-- memfold:begin -->
# Project memory

## Preferences
- Use tabs for indentation, width 4

## Decisions
- **Database choice**: We chose Postgres over MySQL for JSONB and partial indexes
<!-- memfold:end -->
```

The same records become a Cursor rule at `.cursor/rules/memfold.mdc`, with the frontmatter Cursor
expects:

```mdc
---
description: Project memory compiled by memfold
alwaysApply: true
---

## Preferences
- Use tabs for indentation, width 4

## Decisions
- **Database choice**: We chose Postgres over MySQL for JSONB and partial indexes
```

## How it works

One store, three ways out.

```
                    memfold store  (SQLite: rows + FTS5 + sqlite-vec)
                            │
        ┌───────────────────┼───────────────────────┐
        ▼                   ▼                         ▼
  compile to files    MCP server (stdio)      daemon (REST + git op-log)
  AGENTS.md,          memory_search,          POST /memories, POST /search
  CLAUDE.md,          memory_write, ...        │
  .cursor/rules, ...                           └── SDKs: TypeScript, Python, Go, Rust
```

1. **Compile.** `memfold compile` writes the store out to each tool's native file, inside managed
   blocks so hand-written text is left alone.
2. **MCP.** `memfold mcp` serves the same memory to any Model Context Protocol client, as tools.
3. **Daemon.** `memfold serve` runs a local REST API. A git-friendly append-only op-log lets two
   machines merge. The SDKs wrap this API, or embed the store directly.

## Install

```bash
npx memfold <command>        # no install
npm i -g memfold             # or install the CLI globally
npm i @memfold/sdk           # TypeScript SDK (embedded or remote)
pip install memfold          # Python SDK (client + framework adapters)
```

The CLI needs Node 20 or newer. Everything runs locally and offline. Semantic search uses a
built-in offline embedder by default, so no API key is required.

## The memory record

Everything is one record type. This is what the `decision` above looks like when you read it back
over the SDK or the REST API:

```json
{
  "id": "01M3BK23WZ6KKQPEVVFCCQQTFV",
  "rev": "01M3BK23X4Q0J7Z2M8V9W1H6PA",
  "type": "decision",
  "scope": "project",
  "scope_path": "/home/me/app",
  "title": "Database choice",
  "body": "We chose Postgres over MySQL for JSONB and partial indexes",
  "summary": null,
  "tags": ["db"],
  "dedup_key": null,
  "content_hash": "sha256:9f2b...c1",
  "provenance": { "source": "user", "tool": "memfold-cli" },
  "salience": 0.5,
  "confidence": 1,
  "decay": { "pinned": false },
  "status": "active",
  "created_at": "2026-09-25T05:12:03.114Z",
  "updated_at": "2026-09-25T05:12:03.114Z",
  "hlc": "000001758777123:000000:96631630"
}
```

The seven `type` values are `fact`, `preference`, `decision`, `convention`, `episodic`, `task`
and `entity`. Rule-like types (`fact`, `preference`, `decision`, `convention`) compile into the
tool files. `episodic` and `task` are recall-only by default. The full JSON Schema is in
[`spec/memory-record.schema.json`](spec/memory-record.schema.json).

## Concepts

- **Scopes.** A record is `global`, `project`, `dir` or `session`. More specific wins, so a
  directory rule overrides a project rule, which overrides a global one.
- **Retrieval.** Search runs two legs, FTS5 keyword ranking (BM25) and `sqlite-vec` vector search,
  and fuses them with reciprocal rank fusion, then reweights by salience and recency.
- **Merge.** Every record carries a hybrid logical clock. Scalars merge last-writer-wins, `tags`
  and `links` are OR-sets (concurrent adds union), deletes are tombstones, and identical bodies
  dedup by `content_hash`. Two machines converge without a central server.
- **Secret gate.** Writes are scanned first. `memfold add "key AKIA..."` is refused before it
  touches the store, and `compile` refuses to render a secret into a file that would be committed.

## CLI

| Command | What it does |
| --- | --- |
| `memfold init` | Create the store and detect installed tools |
| `memfold add <text>` | Add a record. `--type`, `--scope`, `--scope-path`, `--title`, `--tags`. Alias `remember` |
| `memfold search <query>` | Hybrid search. `--limit`, `--scope`, `--type`. Alias `recall` |
| `memfold list` | List records. `--scope`, `--type` |
| `memfold forget <id>` | Tombstone a record |
| `memfold compile` | Write the store out to tool files. `--targets <ids>`, `--all`, `--dry-run` |
| `memfold import` | Read existing tool files into the store. `--from <id>` |
| `memfold sync` | `import` then `compile` back out to detected tools |
| `memfold serve` | Start the REST daemon. `--port`, `--host`, `--token` |
| `memfold mcp` | Start the MCP server over stdio |
| `memfold doctor` | Store stats, detected tools, and a secret scan |

Use `--global` on `init`, `add` and friends to target `~/.memfold` instead of the project store.

## Supported tools

`compile` and `import` cover eight tools today. Each writes the file the tool actually reads:

| Tool | File(s) written |
| --- | --- |
| AGENTS.md convention | `AGENTS.md` |
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursor/rules/memfold.mdc` |
| Windsurf | `.windsurf/rules/memfold.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Gemini CLI | `GEMINI.md` |
| Cline | `.clinerules/memfold.md` |
| Aider | `CONVENTIONS.md` (and a `read:` entry in `.aider.conf.yml`) |

Files that already exist are edited in place inside `<!-- memfold:begin -->` / `<!-- memfold:end -->`
markers, so your own text is preserved.

## MCP server

`memfold mcp` speaks the Model Context Protocol over stdio. It registers five tools, so even
clients that ignore MCP resources get the full surface: `memory_search`, `memory_write`,
`memory_get`, `memory_list`, `memory_forget`. Resources `memory://index` and
`memory://record/{id}` are offered as a progressive enhancement.

Point any MCP client at it:

```json
{
  "mcpServers": {
    "memfold": { "command": "npx", "args": ["memfold", "mcp"] }
  }
}
```

## Daemon and REST API

`memfold serve` starts a local HTTP API over the same store. It binds `127.0.0.1` and runs
without auth unless you pass `--token`, in which case every route except `/health` needs
`Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | `{ status, vectorEnabled, count }` |
| `POST` | `/memories` | Create a record from `{ type, scope, body, ... }` |
| `GET` | `/memories` | List, filters `scope`, `scopePath`, `type`, `status` |
| `GET` | `/memories/:id` | Fetch one, or 404 |
| `PATCH` | `/memories/:id` | Revise a record |
| `DELETE` | `/memories/:id` | Tombstone a record |
| `POST` | `/search` | `{ query, limit?, scope?, scopePath?, types? }` |

```bash
curl -s http://127.0.0.1:7077/search \
  -H 'content-type: application/json' \
  -d '{"query":"which database","limit":3}'
# => [{ "record": { "id": "01M3BK23...", "type": "decision", ... }, "score": 0.025, "via": ["fts"] }]
```

## SDKs

**TypeScript** (`@memfold/sdk`). Embed the store in-process, or talk to the daemon with
`MemfoldClient`. Both satisfy the same interface, and the LangGraph and Vercel AI adapters accept
either.

```ts
import { Memfold } from '@memfold/sdk'

const m = new Memfold()                        // in-process store
await m.add({ type: 'convention', scope: 'project', body: 'Run pnpm test before committing' })
const hits = await m.search('pre-commit checks')
```

**Python** (`memfold`). A client for the daemon, plus LangGraph, Google ADK and CrewAI adapters.

```python
from memfold import MemfoldClient

c = MemfoldClient("http://127.0.0.1:7077")
c.add(type="convention", scope="project", body="Run pnpm test before committing")
hits = c.search("pre-commit checks", limit=5)
```

**Go**. A standard-library REST client, no third-party dependencies.

```go
import (
    "context"
    memfold "github.com/zkasuran/memfold/sdks/go"
)

c := memfold.NewClient("http://127.0.0.1:7077")
rec, err := c.Add(context.Background(), memfold.AddInput{
    Type: "fact", Scope: "project", Body: "The API base URL comes from API_BASE_URL",
})
```

**Rust**. A blocking `ureq` client.

```rust
use memfold::{Client, AddInput, Provenance, SearchInput};

let client = Client::new("http://127.0.0.1:7077");
client.add(AddInput::new("fact", "project", "API base URL comes from API_BASE_URL", Provenance::new("user")))?;
let hits = client.search(SearchInput::new("which database"))?;
```

## Architecture

```
memfold/
├── spec/               protocol, memory-record schema, MCP + REST + adapter matrix
├── conformance/        schema vectors and a runner
├── packages/
│   ├── core/           @memfold/core       store, hybrid retrieval, HLC merge, secret gate
│   ├── adapters/       @memfold/adapters    per-tool read, write and compile
│   ├── mcp/            @memfold/mcp         MCP server over stdio
│   ├── daemon/         @memfold/daemon      REST API and git op-log
│   ├── sdk/            @memfold/sdk         TypeScript SDK and framework adapters
│   └── cli/            memfold              the command-line tool
├── sdks/               python/  go/  rust/
└── docs/
```

| Package | Role | License |
| --- | --- | --- |
| `@memfold/core` | Store, retrieval, merge, secret gate | Apache-2.0 |
| `@memfold/adapters` | Read, write and compile tool files | Apache-2.0 |
| `@memfold/mcp` | MCP server | Apache-2.0 |
| `@memfold/sdk` | TypeScript SDK | Apache-2.0 |
| `@memfold/daemon` | REST daemon and sync | FSL-1.1-ALv2 |
| `memfold` | CLI | FSL-1.1-ALv2 |

## How it compares

Two kinds of tools exist today, and neither does the whole job. Rules-sync tools generate a bunch
of instruction files from one source, but they are one-shot and hold no memory. Agent-memory tools
store what an agent learned, but they live in one silo and do not unify the rules files each tool
reads. memfold does both at once: one canonical store, compiled into every tool's native file,
served live to MCP clients, and reachable over REST for agents and scripts.

## Development

```bash
pnpm install
pnpm build       # tsup builds every package
pnpm test        # vitest across all packages
pnpm typecheck   # tsc, no emit
pnpm lint        # biome
```

The TypeScript workspace passes 51 tests across core, adapters, the MCP server, the daemon, the
SDK, the CLI and a schema conformance suite. The Go client passes 11, the Python SDK 16, the Rust
client 9 plus a doc-test. CI runs all four languages on GitHub Actions. The normative spec is in
[`spec/`](spec/) and the longer guides are in [`docs/`](docs/).

## Roadmap

- More adapters for tools that ship their own memory files (Roo, Kilo, opencode, Amp, Goose, Amazon Q)
- The secret gate enforced on every store write, not only on compile
- Publishing `@memfold/*` to npm, `memfold` to PyPI, and the crate and Go module to their registries

## License

memfold is source-available, which is not the same as OSI open source. The specification, the
conformance suite, `@memfold/core`, `@memfold/adapters`, `@memfold/mcp`, `@memfold/sdk` and the Go,
Python and Rust SDKs are Apache-2.0, so anyone can implement the protocol and build on it. The
`@memfold/daemon` and the `memfold` CLI are under the Functional Source License (FSL-1.1-ALv2),
which permits any use except standing up a competing product and converts to Apache-2.0 two years
after each release. See [`LICENSE`](LICENSE).

## Acknowledgements

memfold builds on two shared conventions rather than replacing them. It compiles to and reads
`AGENTS.md`, the cross-tool instruction file, and it speaks the Model Context Protocol so any MCP
client can use the same memory.





