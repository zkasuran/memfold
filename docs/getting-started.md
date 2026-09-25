# Getting started

This page takes you from an empty repository to memory that your AI coding tools can read, live and on
disk. It uses the surfaces that ship today: the `@memfold/sdk` package, the `memfold-mcp` server and
the `memfold-daemon`. Where a `memfold ...` CLI command appears, it is the planned equivalent and is
called out as in progress.

## Requirements

- Node 22 or newer. The SDK's remote client uses the global `fetch`, and the daemon runs on Node.
- pnpm or npm for installing packages.

## Install

```sh
pnpm add @memfold/sdk
```

`@memfold/sdk` pulls in `@memfold/core`, which carries the SQLite store. Vector search loads through
`sqlite-vec` when it is available and falls back to keyword-only retrieval when it is not, so the
store works either way.

## Add your first memory

A memory is a **record**: a typed, scoped item with a body. The smallest useful write picks a `type`
and a `scope` and gives a `body`.

```ts
import { Memfold } from '@memfold/sdk'

const mem = new Memfold('./.memory/index.db') // omit the path for an in-memory store

await mem.add({
  type: 'convention',
  scope: 'project',
  body: 'HTTP handlers return errors as { error: { code, message } }; never leak stack traces.',
  tags: ['api', 'errors'],
})

await mem.add({
  type: 'preference',
  scope: 'global',
  body: 'The user prefers tabs over spaces.',
})
```

`type` is one of `fact`, `preference`, `decision`, `convention`, `episodic`, `task` or `entity`.
`scope` is `global`, `project`, `dir` or `session`. The [concepts](concepts.md) page explains what
each means and how they rank against each other.

## Search it back

Search is hybrid: keyword (BM25) fused with vector similarity, then reranked by salience, recency and
confidence.

```ts
const hits = await mem.search('how do handlers return errors', { limit: 5 })
for (const hit of hits) {
  console.log(hit.score.toFixed(3), hit.record.body)
}
```

Each hit carries the full record, a blended `score` and `via`, the retrieval legs that matched it
(`fts`, `vec` or both).

## Compile it out to your tools

The value of one store is that it writes every tool's native file. `@memfold/adapters` detects the
tools a repo is configured for and renders each one's files, merging into managed blocks so your
hand-written text survives.

```ts
import { detectInstalled, compileAll, writeCompiled } from '@memfold/adapters'

const root = process.cwd()
const records = await mem.list({ status: 'active' })

const adapters = await detectInstalled(root)     // e.g. Claude Code + Cursor + Copilot
const files = compileAll(records, adapters, root)
await writeCompiled(files)                        // creates dirs, merges blocks, blocks secrets
```

This writes `CLAUDE.md`, `.cursor/rules/memfold.mdc`, `.github/copilot-instructions.md` and whatever
else the repo uses. Episodic and task records are recall-only and are left out of always-on rules
files by default. The planned CLI shortcut is `memfold compile`.

## Serve it over MCP

Point any MCP client at the `memfold-mcp` binary. It runs over stdio and reads its database path from
the environment.

```json
{
  "mcpServers": {
    "memfold": {
      "command": "memfold-mcp",
      "env": { "MEMFOLD_DB": "./.memory/index.db" }
    }
  }
}
```

The client then has `memory_search`, `memory_write`, `memory_get`, `memory_list` and `memory_forget`.
See [MCP](mcp.md).

## Or run the daemon

For editors, scripts and non-MCP clients, run the local REST daemon. It binds to loopback. Set a
bearer token before you expose it anywhere.

```sh
MEMFOLD_DB=./.memory/index.db MEMFOLD_TOKEN=$(openssl rand -hex 16) npx memfold-daemon
```

```sh
curl -s localhost:7077/health -H "authorization: Bearer $MEMFOLD_TOKEN"
```

See [Daemon REST](daemon-rest.md).

## Where it lives on disk

A committed store holds the shared `project` and `dir` records for a repository. A separate
machine-local store holds `global` and personal records, so nothing private is committed.

```
.memory/
  records/<id>.md     one record per file: YAML frontmatter + markdown body
  oplog.jsonl         append-only operation log (git syncs this)
  index.db            SQLite mirror; a rebuildable cache, gitignored
```

## Next steps

- Read [Concepts](concepts.md) to understand scopes, precedence, merge and decay.
- Wire an agent framework through the [SDK](sdk.md) adapters.
- Review the [FAQ](faq.md) for how memfold handles secrets, precedence and portability.
