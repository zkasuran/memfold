# @memfold/mcp

Model Context Protocol server that exposes a memfold memory store to any MCP client.

Memfold keeps one memory across every AI coding tool. This package makes that memory reachable
over MCP, so a client like Claude Code, Cursor, VS Code, Codex or Gemini CLI can search, write,
read and forget memories through the same store.

## Design

Every read and every write is a **tool**. Tools are the one primitive every MCP client
implements, and the only one that can mutate, so leaning on them keeps the memory usable in
tool-only clients (Zed, Windsurf, ChatGPT, most CLIs). The `memory://` resources are a
progressive enhancement for clients that also read resources; nothing is available only through
a resource, so a tool-only client keeps the full surface.

### Tools

| Tool | Input | Result |
|---|---|---|
| `memory_search` | `query`, `limit?`, `scope?`, `types?` | ranked hits: `id, type, scope, title/summary, score, via` |
| `memory_write` | `type`, `scope`, `body`, `title?`, `tags?`, `scope_path?` | created `id`, `rev`, `type`, `scope` |
| `memory_get` | `id` | the full record, or `{ found: false }` |
| `memory_list` | `scope?`, `type?`, `limit?` | `{ count, items }` of active records |
| `memory_forget` | `id` | `{ forgotten }` after tombstoning |

Tool results are text blocks carrying compact JSON.

### Resources

- `memory://index` lists all active records.
- `memory://record/{id}` returns one record by id, and enumerates records for discovery.

## Usage

### As a library

```ts
import { SqliteStore, makeHlcState } from '@memfold/core'
import { createMemfoldMcpServer } from '@memfold/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const store = new SqliteStore('memory.db')
const server = createMemfoldMcpServer(store, { hlc: makeHlcState('my-node'), nodeId: 'my-node' })
await server.connect(new StdioServerTransport())
```

Pass `{ resources: false }` to register tools only.

### As a launched server (stdio)

An MCP client spawns the `memfold-mcp` binary. It reads:

- `MEMFOLD_DB` — SQLite file path. Default: `$XDG_DATA_HOME/memfold/memory.db`
  (falling back to `~/.local/share/memfold/memory.db`). Use `:memory:` for an ephemeral store.
- `MEMFOLD_NODE_ID` — node identity for HLC stamps and write authorship. Default: the hostname.

Example client config entry:

```json
{
  "mcpServers": {
    "memfold": { "command": "memfold-mcp", "env": { "MEMFOLD_DB": "/path/to/memory.db" } }
  }
}
```

The stdio transport is unauthenticated by design: it runs as a local subprocess and takes its
configuration from the environment. Do not expose this process over a network without an
authenticating transport in front of it.

## License

Apache-2.0
