# memfold documentation

One common memory for every AI coding tool and agent framework. These pages explain how memfold
works and how to use each surface. For the normative protocol and the record schema, see
[`../spec/`](../spec/).

## Start here

- [Getting started](getting-started.md). Install, add your first memory, compile it out to your tools
  and serve it over MCP or the daemon.
- [Concepts](concepts.md). The record model, scopes and precedence, HLC merge, decay and the secret
  gate.

## Surfaces

- [CLI](cli.md). The `memfold` command-line tool, command by command.
- [Adapters](adapters.md). The per-tool compile matrix and the managed-block merge.
- [MCP](mcp.md). The Model Context Protocol server, its tools and resources.
- [Daemon REST](daemon-rest.md). The local HTTP API and the op-log.
- [SDK](sdk.md). The TypeScript SDK and the LangGraph and Vercel AI adapters, plus the status of the
  Python, Go and Rust clients.

## Reference

- [FAQ](faq.md). Precedence, secrets, portability and how memfold relates to `AGENTS.md` and MCP.
- Specification: [`../spec/protocol.md`](../spec/protocol.md),
  [`../spec/mcp.md`](../spec/mcp.md) and [`../spec/memory-record.schema.json`](../spec/memory-record.schema.json).

## Status

memfold is in active development at `schema_version: 1`. The TypeScript packages (`@memfold/core`,
`@memfold/adapters`, `@memfold/mcp`, `@memfold/daemon`, `@memfold/sdk`) are built and tested. The
`memfold` CLI and the Python, Go and Rust clients are in progress. Pages that document the CLI mark
this at the top. Each shows the surface that runs today.
