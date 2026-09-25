# memfold daemon REST contract

The memfold daemon is a local HTTP service over the same store the file compiler and the MCP server
use. It exists for editors, scripts and agent frameworks that speak HTTP rather than MCP. Every
mutation is also appended to the git op-log (`oplog.jsonl`, protocol section 4.2), so the REST surface
and a git history stay in step.

## Conventions

- Bodies and responses are `application/json; charset=utf-8`.
- A `record` in any response is a full Memory Record as defined in `spec/protocol.md`. Timestamps are
  RFC 3339 UTC strings.
- The daemon binds to loopback (`127.0.0.1`) by default. If it is bound to a routable address it MUST
  require auth, because an open memory endpoint both leaks and lets anyone write to a shared store.
- **Optional Bearer auth.** When the daemon is started with a token, every endpoint except
  `GET /health` requires `Authorization: Bearer <token>`. A missing or wrong token returns `401` with
  `{ "code": "unauthorized" }`. With no token configured (loopback dev default) the endpoints are open.
- Query filters use camelCase (`scopePath`). Repeatable filters (`type`) may appear more than once.

## Errors

Errors return a JSON body `{ "code", "message" }` plus any extra fields, with these codes and statuses:

| Code | Status | When |
|---|---|---|
| `invalid_input` | 422 | Body or query failed validation. |
| `secret_detected` | 422 | A write tripped the secret gate. Nothing was written. `findings[]` included, values masked. |
| `not_found` | 404 | No record for the given id. |
| `unauthorized` | 401 | Missing or invalid Bearer token. |

## Endpoints

### GET /health

Liveness and a quick store summary. No auth.

```
GET /health
```
```json
200 OK
{ "status": "ok", "schema_version": 1, "node_id": "laptop-a", "records": 128, "uptime_s": 4210 }
```

### POST /memories

Create a record or update the existing one when `dedup_key` matches within the scope. Required in the
body: `type`, `scope`, `body`. The daemon assigns `id`, `rev`, `content_hash`, `hlc` and timestamps and
runs the secret gate before persisting.

```
POST /memories
```
```json
{
  "type": "convention",
  "scope": "dir",
  "scopePath": "packages/api",
  "body": "API errors use { error: { code, message } }; never leak stack traces.",
  "summary": "API errors use { error: { code, message } }.",
  "tags": ["api", "errors"],
  "dedupKey": "conv:api-error-shape",
  "salience": 0.7,
  "provenance": { "source": "user", "tool": "codex" }
}
```
```json
201 Created
Location: /memories/C6ED3NV8JGA12QKE5YKZ99E5RT
{ "record": { "id": "C6ED3NV8JGA12QKE5YKZ99E5RT", "type": "convention", "...": "..." } }
```
A secret in the body returns `422` with `{ "code": "secret_detected", "findings": [ ... ] }` and writes
nothing.

### GET /memories

List records, filtered and paginated, without ranking. For browsing and audit.

```
GET /memories?scope=project&scopePath=.&type=convention&type=decision&status=active&limit=50
```
Query params, all optional: `scope`, `scopePath`, `type` (repeatable), `status` (default `active`;
`archived` or `tombstone` to inspect them), `limit` (default 50), `cursor`.
```json
200 OK
{ "records": [ { "...": "..." } ], "next_cursor": "eyJvZmZzZXQiOjUwfQ==" }
```

### GET /memories/:id

Fetch one record by id.

```
GET /memories/C6ED3NV8JGA12QKE5YKZ99E5RT
```
```json
200 OK
{ "record": { "id": "C6ED3NV8JGA12QKE5YKZ99E5RT", "...": "..." } }
```
Unknown id returns `404` with `{ "code": "not_found" }`.

### PATCH /memories/:id

Edit a record. This produces a new `rev` chained by `supersedes`, bumps the `hlc` and re-runs the secret
gate. Only mutable fields may be patched: `title`, `body`, `summary`, `tags`, `salience`, `confidence`,
`decay`, `status`, `links`, `sensitivity`.

```
PATCH /memories/C6ED3NV8JGA12QKE5YKZ99E5RT
```
```json
{ "salience": 0.9, "tags": ["api", "errors", "http"] }
```
```json
200 OK
{ "record": { "rev": "7RZ5ACTQFMMW26VHC0DJE88H5B", "salience": 0.9, "...": "..." } }
```

### DELETE /memories/:id

Delete a record. Default `mode=tombstone` (excluded everywhere, still logged and auditable);
`mode=archive` retains it, searchable on request, not emitted into rules.

```
DELETE /memories/A9VDJ7KKS8WAFJVDSNG06HYHRR?mode=tombstone
```
```json
200 OK
{ "id": "A9VDJ7KKS8WAFJVDSNG06HYHRR", "status": "tombstone" }
```

### POST /search

Hybrid full-text plus vector search over active records, ranked. Returns an array, each element a hit
with the record, a relevance `score` and `via`, the retrieval path that surfaced it (`fts`, `vector` or
`hybrid`).

```
POST /search
```
```json
{ "query": "how do api handlers return errors", "limit": 8, "scope": "project", "scopePath": ".", "types": ["convention", "decision"] }
```
```json
200 OK
[
  { "record": { "id": "C6ED3NV8...", "type": "convention", "...": "..." }, "score": 0.82, "via": "hybrid" },
  { "record": { "id": "A9VDJ7KK...", "type": "decision", "...": "..." }, "score": 0.55, "via": "fts" }
]
```
Only `query` is required. `limit` defaults to 8, `types` filters by record type, `scope` plus
`scopePath` restrict the search to what is in context for the caller.

---

SPDX-License-Identifier: Apache-2.0
