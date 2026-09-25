# memfold MCP contract

memfold exposes memory over the Model Context Protocol so any MCP-capable coding tool can read and
write the shared store live, without a file compile step. This document specifies the tool surface, the
optional resources and the transport and auth expectations.

## Why tools are primary

MCP servers expose three primitives: tools (model-controlled, the only primitive that can mutate),
resources (application-controlled, a natural fit for reads) and prompts (user-controlled). Across the
tracked client matrix, `tools/list` and `tools/call` are the one thing every client implements, while
resource read and subscribe are inconsistent (VS Code and a handful of others) and prompt support is
partial. Reading through resources alone would make memory invisible in Zed, Windsurf and most CLI-only
clients.

So memfold makes **every read and write a tool** and treats resources as a progressive enhancement
that mirrors the same data for clients that use them. This is the single most important design choice in
the contract.

## Transport and auth

- **Local:** ship a **stdio** server that a coding tool spawns. It takes any credentials from the
  environment and needs no OAuth.
- **Remote or shared:** expose **Streamable HTTP** in the widely implemented 2025-06-18 shape (session
  header, optional GET stream) and feature-detect the 2026-07-28 stateless model rather than assuming
  it, because clients do not implement it yet.
- A network-exposed memory endpoint MUST NOT ship without auth. A shared store that anyone can read or
  write is a leak and a poisoning vector. Remote servers MUST require OAuth 2.1 (or at minimum a bearer
  token for clients that only do header auth) and MUST validate the `Origin` header against DNS
  rebinding. Local stdio may be unauthenticated.
- Tool names are namespaced (`memory_search`, not `search`) to avoid collisions when a host aggregates
  several servers. Results use `outputSchema` plus `structuredContent` so they are typed and the same
  JSON shape is returned whether a client reads via a tool or a resource.

## Tools

All records in inputs and outputs are Memory Records as defined in `spec/protocol.md`. A `record` in a
result is the full validated record. Scope filters follow the resolver semantics in protocol section 2.

### `memory_search`

Hybrid full-text plus vector search over active records, ranked by relevance, salience and recency.

Input:
```json
{
  "query": "how do api handlers return errors",
  "scope": "project",
  "scope_path": ".",
  "type": ["convention", "decision"],
  "tags": ["api"],
  "session_id": "DA7TB3EYW36S7KHQJDANW3M5FD",
  "k": 8
}
```
Only `query` is required. `type` and `tags` are optional filters, `k` caps the hit count (default 8).
`scope` plus `scope_path` and `session_id` scope the search to what is in context for the caller.

Output:
```json
{
  "hits": [
    { "record": { "id": "C6ED3NV8...", "type": "convention", "...": "..." }, "score": 0.82 }
  ]
}
```

### `memory_write`

Create a record or update the existing one when `dedup_key` matches within the scope. Runs the secret
gate before persisting.

Input:
```json
{
  "type": "convention",
  "scope": "dir",
  "scope_path": "packages/api",
  "body": "API errors use { error: { code, message } }; never leak stack traces.",
  "summary": "API errors use { error: { code, message } }.",
  "tags": ["api", "errors"],
  "dedup_key": "conv:api-error-shape",
  "salience": 0.7,
  "provenance": { "source": "agent", "tool": "cursor" }
}
```
Required: `type`, `scope`, `body`. `provenance.source` defaults to `agent` when the server cannot infer
it. The server assigns `id`, `rev`, `content_hash`, `hlc` and timestamps.

Output: `{ "record": { "...": "the stored record" } }`.

On a detected secret the call fails with an error result (see Errors) and nothing is written.

### `memory_get`

Fetch one record by id.

Input: `{ "id": "C6ED3NV8JGA12QKE5YKZ99E5RT" }`

Output: `{ "record": { "...": "..." } }` or `{ "record": null }` when the id is unknown or tombstoned.

### `memory_list`

Enumerate records, filtered and paginated, without ranking. For browsing and audit rather than recall.

Input:
```json
{ "scope": "project", "scope_path": ".", "type": "convention", "status": "active", "limit": 50, "cursor": null }
```
All fields optional. `status` defaults to `active`; pass `archived` or `tombstone` to inspect them.

Output:
```json
{ "records": [ { "...": "..." } ], "next_cursor": "eyJvZmZzZXQiOjUwfQ==" }
```
`next_cursor` is null when the last page is reached.

### `memory_forget`

Delete a record. This is a tombstone (protocol 3.3), not a physical drop, so the delete propagates on
sync and stays auditable.

Input: `{ "id": "A9VDJ7KKS8WAFJVDSNG06HYHRR", "mode": "tombstone" }`

`mode` is `tombstone` (default, excluded everywhere) or `archive` (retained, searchable on request, not
emitted into rules).

Output: `{ "id": "A9VDJ7KKS8WAFJVDSNG06HYHRR", "status": "tombstone" }`

## Resources (optional)

For clients that read resources (VS Code, Goose, Gemini CLI, Cursor, Claude Code and a few others),
memfold mirrors the same data as resources so the host can inject memory without a tool round-trip. The
resource output MUST be identical to the matching tool output, so there is one code path.

- `memory://record/{id}` returns one record, mirroring `memory_get`.
- `memory://{scope}/{scope_path}` is a resource template (RFC 6570) returning the resolved active set
  for a scope, mirroring `memory_list` under the resolver rules.
- A subscribable resource MAY emit `notifications/resources/updated` on write, for live memory sync.
  Subscribe is one of the least implemented features (mainly VS Code), so live push is optional and a
  server MUST work without it.

Resources are a progressive enhancement. A client that ignores them still has the full surface through
tools.

## Prompt (optional)

A single user-controlled prompt `memory-context` MAY be exposed so a user can pull current memory into
a prompt-capable client (Claude Code, Cursor, Gemini CLI, Zed, VS Code, Goose) on demand. It is a
convenience affordance, it cannot mutate and it is never the primary path.

## Errors

Errors are returned as tool error results with a stable `code` and a human `message`. Defined codes:

- `invalid_input`: the arguments failed schema validation.
- `not_found`: `memory_get` or `memory_forget` was given an unknown id.
- `secret_detected`: `memory_write` content tripped the secret gate; nothing was written.
- `conflict`: a write could not be reconciled and needs a retry with a fresh read.

The `secret_detected` shape reports findings by kind with the value masked, never in full:

```json
{
  "code": "secret_detected",
  "message": "refusing to write: 1 secret(s) detected",
  "findings": [ { "kind": "aws-access-key-id", "match": "AKI…LE [redacted 20 chars]" } ]
}
```

---

SPDX-License-Identifier: Apache-2.0
