# MCP

memfold exposes memory over the Model Context Protocol so any MCP-capable coding tool can read and
write the shared store live, without a file compile step. `@memfold/mcp` (Apache-2.0) is the server.
The normative contract is [`../spec/mcp.md`](../spec/mcp.md); this page is the working reference.

## Why tools, not resources

MCP servers expose three primitives: tools (the only one that can mutate), resources (a natural fit
for reads) and prompts. Across the client matrix, tools are the one primitive every client implements,
while resource support is inconsistent and prompt support is partial. Reading through resources alone
would make memory invisible in Zed, Windsurf and most CLI-only clients.

So memfold makes **every read and write a tool**, and treats resources as a progressive enhancement
that mirrors the same data for clients that use them. A tool-only client keeps the full surface.

## Tools

| Tool | Input | Result |
|---|---|---|
| `memory_search` | `query`, `limit?`, `scope?`, `types?` | ranked hits: `id`, `type`, `scope`, `title`/`summary`, `score`, `via` |
| `memory_write` | `type`, `scope`, `body`, `title?`, `tags?`, `scope_path?` | the created `id`, `rev`, `type`, `scope` |
| `memory_get` | `id` | the full record, or `{ found: false }` |
| `memory_list` | `scope?`, `type?`, `limit?` | `{ count, items }` of active records |
| `memory_forget` | `id` | `{ forgotten }` after tombstoning |

Tool results are text blocks carrying compact JSON. `memory_write` runs the secret gate before it
persists; a detected credential fails the call and writes nothing.

## Resources

Registered by default, disable with `{ resources: false }`:

- `memory://index` lists all active records.
- `memory://record/{id}` returns one record by id and enumerates records for discovery.

Nothing is available only through a resource, so turning them off costs a client nothing but the
mirror.

## Run it as a launched server

An MCP client spawns the `memfold-mcp` binary over stdio and configures it from the environment:

```json
{
  "mcpServers": {
    "memfold": {
      "command": "memfold-mcp",
      "env": { "MEMFOLD_DB": "/path/to/index.db" }
    }
  }
}
```

- `MEMFOLD_DB` is the SQLite path. Default `$XDG_DATA_HOME/memfold/memory.db`, falling back to
  `~/.local/share/memfold/memory.db`. Use `:memory:` for an ephemeral store.
- `MEMFOLD_NODE_ID` is the node identity for HLC stamps and write authorship. Default: the hostname.

## Embed it in a process

```ts
import { SqliteStore, makeHlcState } from '@memfold/core'
import { createMemfoldMcpServer } from '@memfold/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const store = new SqliteStore('index.db')
const server = createMemfoldMcpServer(store, {
  hlc: makeHlcState('my-node'),
  nodeId: 'my-node',
  resources: true,
})
await server.connect(new StdioServerTransport())
```

## Transport and security

- **Local:** the stdio server runs as a subprocess and takes its configuration from the environment.
  It needs no OAuth and is unauthenticated by design.
- **Remote or shared:** expose Streamable HTTP. A network-exposed memory endpoint must not ship
  without auth. A shared store anyone can read or write is a leak and a poisoning vector. Require OAuth
  2.1 or at minimum a bearer token, and validate the `Origin` header against DNS rebinding.

Do not put the stdio process on a network without an authenticating transport in front of it.
