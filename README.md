# memfold

One common memory for every AI coding tool and agent framework.

[![CI](https://github.com/zkasuran/memfold/actions/workflows/ci.yml/badge.svg)](https://github.com/zkasuran/memfold/actions/workflows/ci.yml)

Source-available (Apache-2.0 + FSL-1.1)

Each AI coding tool reads from its own rules file. Claude Code reads CLAUDE.md, Codex reads AGENTS.md, Cursor reads `.cursor/rules`. memfold keeps one canonical, local-first memory store and projects it into every tool you use. You write once and every tool sees the same rules and context.

## The problem

There are twenty-plus AI tool conventions. Each keeps memory in a private file (CLAUDE.md, AGENTS.md, `.cursor/rules`, `.github/instructions`, GEMINI.md, plus many more). Switching tools loses context. Running several means copying rules by hand. They drift over time. Worse, secrets sometimes leak into committed rules files.

## How it works

Three surfaces, one store.

```
                memfold store (SQLite, local)
                ├── compiled native files (per tool)
                ├── MCP server (stdio)
                └── daemon (REST + sync op-log)
                       ├── @memfold/sdk
                       ├── Python SDK
                       ├── Go SDK
                       └── Rust SDK
```

1. Compile. Writes the store out to each tool's native file. Output sits inside managed-block markers so hand-written text outside the blocks is preserved.
2. MCP. Serves the same memory live over stdio to any Model Context Protocol client.
3. Daemon. A local REST API plus a git-backed append-only op-log so multiple machines can merge changes. Wrapped by the SDKs.

## Quickstart

```bash
npx memfold init
npx memfold add "Always run pnpm test before committing"
npx memfold search "pre-commit checks"
npx memfold compile --all
```

`init` creates the store and detects which AI tools are installed in the current directory. `add` writes a new record. `search` runs hybrid retrieval. `compile` projects the store into every detected tool.

## Concepts

- Record. A memory entry with `id`, `rev`, `type`, `scope`, `scope_path`, `title`, `body`, `summary`, `tags`, `dedup_key`, `content_hash`, `provenance`, `salience`, `confidence`, `decay`, `created_at`, `updated_at`, `status`, `links`, `hlc`. Types include `fact`, `preference`, `decision`, `convention`, `episodic`, `task`, `entity`.
- Scopes. `global`, `project`, `dir`, `session`. More specific scope wins.
- Retrieval. FTS5 keyword (BM25) + sqlite-vec vector search, fused with reciprocal rank fusion.
- Merge. Hybrid logical clock with last-writer-wins for scalars, OR-set for tags and links, tombstones for deletes, dedup by content hash.
- Secret gate. A pre-write check refuses to write a detected credential into any record or compiled file.

## CLI

| Command | What it does |
| --- | --- |
| `init` | Create the store and detect installed tools |
| `add` (alias `remember`) | Write a new memory record |
| `search` (alias `recall`) | Query the store with hybrid retrieval |
| `list` | List records with filters |
| `forget` | Tombstone a record |
| `compile` | Write the store out to native files (flags `--targets`, `--all`, `--dry-run`) |
| `import` | Read native files into the store |
| `sync` | Run `import` then `compile` |
| `serve` | Start the local REST daemon |
| `mcp` | Start the MCP server over stdio |
| `doctor` | Show store stats, detected tools and a secret scan |

## Supported tools

| Tool | File written |
| --- | --- |
| AGENTS.md convention | `AGENTS.md` |
| Claude Code | `CLAUDE.md`, `.claude/rules` |
| Cursor | `.cursor/rules/*.mdc` |
| Windsurf | `.windsurf/rules` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions` |
| Gemini | `GEMINI.md` |
| Cline | `.clinerules` |
| Aider | `CONVENTIONS.md` |

Compiled content lives inside managed-block markers, so hand-written text outside the blocks is preserved across recompiles.

## MCP server

Five tools: `memory_search`, `memory_write`, `memory_get`, `memory_list`, `memory_forget`. The server also exposes resources `memory://index` and `memory://record/{id}` as a progressive enhancement for clients that render resources. Transport is stdio. Tools come first because some clients ignore resources.

Example client config:

```json
{
  "mcpServers": {
    "memfold": {
      "command": "npx",
      "args": ["memfold", "mcp"]
    }
  }
}
```

## Daemon and REST API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| POST | `/memories` | Create a record |
| GET | `/memories` | List records (filters: `scope`, `scopePath`, `type`, `status`) |
| GET | `/memories/:id` | Fetch one record |
| PATCH | `/memories/:id` | Update a record |
| DELETE | `/memories/:id` | Tombstone a record |
| POST | `/search` | Hybrid search |

The daemon binds 127.0.0.1 by default and is unauthenticated unless a bearer token is set.

Example:

```bash
curl -s "$MEMFOLD_URL/memories?scope=project" \
  -H "Authorization: Bearer $MEMFOLD_TOKEN"
```

## SDKs

TypeScript (`@memfold/sdk`), embedded form:

```ts
import { Memfold } from "@memfold/sdk";

const m = new Memfold();
await m.add({ type: "convention", scope: "project", body: "Run pnpm test before committing" });
```

Use `MemfoldClient` for the remote daemon. Adapters are included for LangGraph and the Vercel AI SDK.

Python (`memfold`, httpx client):

```python
from memfold import MemfoldClient

c = MemfoldClient("http://127.0.0.1:7077")
c.add(type="convention", scope="project", body="Run pnpm test before committing")
```

Adapters are included for LangGraph, Google ADK and CrewAI.

Go (standard-library REST client):

```go
import memfold "github.com/zkasuran/memfold/sdks/go"

c := memfold.NewClient("http://127.0.0.1:7077")
```

Rust (ureq REST client):

```rust
use memfold::Client;

let c = Client::new("http://127.0.0.1:7077");
```

## Architecture

| Package | Role | License |
| --- | --- | --- |
| `memfold` (CLI) | Command-line entry point | FSL-1.1-ALv2 |
| `@memfold/core` | Store, retrieval, merge | Apache-2.0 |
| `@memfold/adapters` | Per-tool read, write and compile | Apache-2.0 |
| `@memfold/mcp` | MCP server over stdio | Apache-2.0 |
| `@memfold/daemon` | REST daemon and sync op-log | FSL-1.1-ALv2 |
| `@memfold/sdk` | TypeScript SDK | Apache-2.0 |
| Spec (`spec/`) | Canonical store and wire format | Apache-2.0 |
| Go SDK | Standard-library REST client | Apache-2.0 |
| Python SDK | `memfold` httpx client | Apache-2.0 |
| Rust SDK | ureq REST client | Apache-2.0 |

FSL-1.1-ALv2 converts to Apache-2.0 two years after each release.

## How it compares

Rules-sync tools compile files but have no persistent memory. Memory tools store context but don't unify the rules files. memfold does both: one store, compiled into every tool's native file, served live to MCP clients and reachable over a REST API for agents and scripts.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Requires Node 20 or newer. Built with pnpm, TypeScript, tsup, vitest and biome. CI runs on GitHub Actions across all four languages: TypeScript 51 tests (across core, adapters, mcp, daemon, sdk, cli plus a conformance suite), Go 11, Python 16, Rust 9 plus a doc-test. The spec lives in `spec/` and prose docs in `docs/`.

## Roadmap

- More adapters for tools that ship their own memory files
- Store-level secret gate enforced on every write path
- Publishing `@memfold/*` to npm, `memfold` to PyPI, the Rust crate to crates.io and the Go module

## License

Source-available, not OSI open source. The spec, `@memfold/core`, `@memfold/adapters`, `@memfold/mcp` and `@memfold/sdk` are Apache-2.0, as are the Go, Python and Rust SDKs. `@memfold/daemon` and the `memfold` CLI are FSL-1.1-ALv2, converting to Apache-2.0 two years after each release.

## Acknowledgements

memfold aligns with the AGENTS.md convention and the Model Context Protocol. Spec lives in `spec/`, docs in `docs/`. Repository: https://github.com/zkasuran/memfold.
