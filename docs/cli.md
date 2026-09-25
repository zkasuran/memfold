# CLI

> **Status: in progress.** The `memfold` CLI is the planned front door to the store, packaged as the
> `memfold` binary over the `@memfold/core`, `@memfold/adapters`, `@memfold/mcp` and `@memfold/daemon`
> packages. Those packages ship and are tested today, and the two servers already have their own
> binaries (`memfold-mcp`, `memfold-daemon`). This page documents the command surface. Where a command
> is not wired yet, the equivalent runs through the SDK or a server binary, noted inline.

The CLI operates on a memfold store, a `.memory/` directory holding record files, an append-only
op-log and a rebuildable SQLite index. Commands read and write that store, compile it out to your
tools and run the servers.

## Global options

| Option | Default | Meaning |
|---|---|---|
| `--store <dir>` | `./.memory` | The store directory to operate on. |
| `--db <path>` | `<store>/index.db` | The SQLite index path. Overrides the store default. |
| `--root <dir>` | current directory | Repo root that scopes and compile paths resolve against. |
| `--json` | off | Emit machine-readable JSON instead of formatted text. |
| `--help` | | Show help for the command. |

## Commands

### `memfold init`

Create a store in the current repository. Writes `.memory/` with an empty record set and an op-log,
and adds the SQLite index to `.gitignore` so the cache is not committed. Safe to re-run; it does not
overwrite existing records.

```sh
memfold init
```

### `memfold add`

Add a record. The body is the positional argument. Type and scope default to `fact` and `project`.

```sh
memfold add "HTTP handlers return errors as { error: { code, message } }" \
  --type convention --scope project --tag api --tag errors
```

| Option | Meaning |
|---|---|
| `--type <t>` | `fact`, `preference`, `decision`, `convention`, `episodic`, `task` or `entity`. |
| `--scope <s>` | `global`, `project`, `dir` or `session`. |
| `--scope-path <p>` | Path the scope binds to (a repo root or directory). |
| `--title <t>` | Short human label. |
| `--summary <s>` | One-line form emitted into rules files when the body is long. |
| `--tag <t>` | A tag. Repeatable. |
| `--dedup-key <k>` | Natural key so re-stating the same setting updates in place. |
| `--salience <n>` | Importance 0 to 1 (default 0.5). |
| `--pin` | Pin the record so it does not decay or get pruned. |

The write passes the secret gate. If the body carries a detected credential the command fails and
nothing is written. Runs today through `@memfold/sdk` (`Memfold.add`).

### `memfold list`

List records without ranking, for browsing and audit.

```sh
memfold list --scope project --type convention
memfold list --status archived
```

Filters: `--scope`, `--scope-path`, `--type`, `--status` (default `active`). Runs today through
`Memfold.list`.

### `memfold search`

Hybrid keyword and vector search, ranked by relevance, salience and recency.

```sh
memfold search "how do handlers return errors" --limit 5
```

Options: `--limit`, `--scope`, `--type` (repeatable). Each hit shows the score and which retrieval
legs matched. Runs today through `Memfold.search`.

### `memfold get`

Show one record by id, including its full body and metadata.

```sh
memfold get 01J9Z6H4Q4Q0M9F3T5R7W8XK2A --json
```

### `memfold edit`

Write a new version of an existing record. The record keeps its `id`, gains a new `rev` and chains
`supersedes`, so history is preserved.

```sh
memfold edit 01J9Z6H4Q4Q0M9F3T5R7W8XK2A --body "Updated rule text" --salience 0.8
```

Editable fields: `--body`, `--title`, `--summary`, `--tag`, `--salience`, `--confidence`. Runs today
through the daemon `PATCH /memories/:id` route (`MemfoldClient.update`).

### `memfold forget`

Tombstone a record so it stops surfacing in reads, search and compiled output. The record is kept in
the store and log so the delete propagates on sync and stays auditable.

```sh
memfold forget 01J9Z6H4Q4Q0M9F3T5R7W8XK2A
memfold forget 01J9Z6H4Q4Q0M9F3T5R7W8XK2A --archive   # softer: retained, searchable on request
```

`--archive` sets `status` to `archived` instead of `tombstone`. Runs today through `Memfold.forget`.

### `memfold compile`

Render the store out to every detected tool's native files. Runs the secret gate before touching
disk, and merges managed blocks so hand-written text survives.

```sh
memfold compile                     # every tool detected in the repo
memfold compile --tool claude-code --tool cursor
memfold compile --dry-run           # print the files that would be written, write nothing
```

| Option | Meaning |
|---|---|
| `--tool <id>` | Restrict to one adapter. Repeatable. Ids: `agents-md`, `claude-code`, `cursor`, `windsurf`, `copilot`, `gemini`, `cline`, `aider`. |
| `--root <dir>` | Repo root the paths resolve against. |
| `--dry-run` | Show the plan without writing. |

Runs today through `@memfold/adapters` (`detectInstalled`, `compileAll`, `writeCompiled`). See
[adapters](adapters.md).

### `memfold import`

Read a tool's existing rules and memory files into the store. Imports are best-effort: each record
gets `provenance.source = import` and the originating tool id. Invisible Unicode is stripped on the
way in.

```sh
memfold import                      # every tool detected in the repo
memfold import --tool cursor
```

Runs today through the adapter `read` methods. See [adapters](adapters.md).

### `memfold serve mcp`

Run the MCP server over stdio so an MCP client can search, write, read and forget live.

```sh
memfold serve mcp
```

This is the `memfold-mcp` binary today:

```sh
MEMFOLD_DB=./.memory/index.db memfold-mcp
```

See [MCP](mcp.md).

### `memfold serve daemon`

Run the local REST daemon over the store, with the git-syncable op-log.

```sh
memfold serve daemon
```

This is the `memfold-daemon` binary today. It binds to loopback and is unauthenticated unless
`MEMFOLD_TOKEN` is set:

```sh
MEMFOLD_DB=./.memory/index.db MEMFOLD_TOKEN=$(openssl rand -hex 16) memfold-daemon
```

See [Daemon REST](daemon-rest.md).

### `memfold status`

Show the store's health: record count, whether the vector leg is enabled and which tools are detected
in the repo. Useful as a quick check before a compile.

```sh
memfold status
```

## Environment variables

The server binaries read their configuration from the environment:

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `MEMFOLD_DB` | `memfold-mcp`, `memfold-daemon` | see below | SQLite index path. `:memory:` for an ephemeral store. |
| `MEMFOLD_NODE_ID` | `memfold-mcp` | hostname | Node identity for HLC stamps and write authorship. |
| `MEMFOLD_PORT` | `memfold-daemon` | `7077` | Port to listen on. |
| `MEMFOLD_HOST` | `memfold-daemon` | `127.0.0.1` | Bind address. Loopback by default. |
| `MEMFOLD_TOKEN` | `memfold-daemon` | unset | When set, every route except `GET /health` needs a bearer token. |
| `MEMFOLD_OPLOG` | `memfold-daemon` | `<MEMFOLD_DB>.oplog.jsonl` | Append-only op-log path. |

`memfold-mcp` defaults `MEMFOLD_DB` to `$XDG_DATA_HOME/memfold/memory.db`, falling back to
`~/.local/share/memfold/memory.db`. `memfold-daemon` defaults it to `memfold.db` in the working
directory.

