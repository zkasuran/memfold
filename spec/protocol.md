# memfold protocol (normative)

This document specifies the memfold Memory Record, how records are scoped and resolved, how they merge
and sync, how they are laid out on disk and the secret gate every write must pass. It is the normative
reference. The machine-readable schema is `spec/memory-record.schema.json` and the reference validator
is `MemoryRecordSchema` in `@memfold/core`.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used per RFC 2119. This is
`schema_version` 1.

## 0. Conventions and forward compatibility

- Timestamps are RFC 3339 / ISO-8601 strings in UTC (for example `2026-09-20T10:00:00Z`).
- Identifiers (`id`, `rev`, related record ids) are ULIDs: 26-character Crockford base32, lexically
  sortable by creation time.
- The v1 JSON Schema sets `additionalProperties: false`, so a strict validator rejects unknown keys.
  The reference validator `@memfold/core` is deliberately lenient: it applies defaults and strips
  unknown keys rather than failing. A conformant implementation MUST accept every record the JSON
  Schema accepts. When reading a record it does not fully understand, an implementation SHOULD
  preserve unknown keys on write rather than drop them, so a newer field survives a round trip through
  an older tool.
- Two schemas, one truth. The JSON Schema documents the on-disk and on-the-wire shape and marks
  `schema_version` and `status` as required. `@memfold/core` supplies defaults for both (and for
  `tags`, `salience`, `confidence`, `decay`, `access_count`, `links`, `sensitivity`, `redactions`) so
  a caller may omit them. A record that omits a defaulted field is valid to the reference validator
  and gains the default on parse.

## 1. The Memory Record

A Memory Record is one durable item of memory: a single fact, preference, decision, convention,
episode, task or entity. It has a stable identity, a type, a scope, a body and the metadata needed to
rank it, merge it, trace it and keep secrets out of it.

### 1.1 Fields

Required fields (no default): `id`, `rev`, `type`, `scope`, `body`, `content_hash`, `provenance`,
`created_at`, `updated_at`, `hlc`. The JSON Schema additionally requires `schema_version` and `status`;
the reference validator defaults them.

**Identity and versioning**

| Field | Type | Meaning |
|---|---|---|
| `id` | string (ULID) | Stable identity across every version of this record. Never changes once assigned. |
| `rev` | string (ULID) | This version's id. A new edit produces a new `rev` under the same `id`. |
| `schema_version` | integer, const `1` | Record format version. Lets a reader refuse or migrate an incompatible record. |
| `content_hash` | string `^sha256:[0-9a-f]{64}$` | sha256 of `body`. Used for dedup and as version identity. |
| `supersedes` | string \| null | The `rev` this version replaces (set on the new version). |
| `superseded_by` | string \| null | Set on an older version when a newer one replaces it. |

**Classification**

| Field | Type | Meaning |
|---|---|---|
| `type` | enum | `fact`, `preference`, `decision`, `convention`, `episodic`, `task`, `entity`. See 1.2. |
| `scope` | enum | `global`, `project`, `dir`, `session`. See 2. |
| `scope_path` | string \| null | Repo or directory path the scope binds to. `null` for `global`. |
| `tags` | string[] | Freeform labels. Merged as an OR-set (see 3.2). |
| `dedup_key` | string \| null | Normalized natural key for "the same logical setting", for example `pref:indent-style`. |

**Content**

| Field | Type | Meaning |
|---|---|---|
| `title` | string \| null | Short human label. |
| `body` | string | Markdown content. Feeds full-text search and the embedder. The unit of `content_hash`. |
| `summary` | string \| null | One-line form emitted into compiled rules files when the full body is too long. |

**Retrieval and lifecycle**

| Field | Type | Meaning |
|---|---|---|
| `salience` | number 0..1 (default 0.5) | Importance weight for retrieval ranking. |
| `confidence` | number 0..1 (default 1) | Trust in the fact being correct. |
| `decay` | object | `half_life_days` (number \| null, null means no decay), `ttl_at` (date-time \| null, a hard expiry), `pinned` (bool, default false, opts out of decay and consolidation pruning). |
| `last_accessed_at` | date-time \| null | When this record was last retrieved. |
| `access_count` | integer >= 0 (default 0) | How many times it has been retrieved. |
| `status` | enum (default `active`) | `active`, `archived` or `tombstone`. See 3.3. |

**Embedding**

| Field | Type | Meaning |
|---|---|---|
| `embedding_model` | string \| null | For example `all-MiniLM-L6-v2`. Enables re-embed on migration. |
| `embedding_dim` | integer \| null | For example 384 or 768. |

**Provenance** (`provenance` object; `source` required)

| Field | Type | Meaning |
|---|---|---|
| `source` | enum | `user`, `agent`, `tool`, `import` or `consolidation`. Who or what produced the record. |
| `tool` | string \| null | Originating tool, for example `claude-code` or `cursor`. |
| `session_id` | string \| null | Session the record was produced in. |
| `author` | string \| null | Human author, where known. |
| `model` | string \| null | Model that wrote it, where the source is an agent. |
| `cite` | string \| null | Source URL or citation key. |

**Merge, time and security**

| Field | Type | Meaning |
|---|---|---|
| `created_at` | date-time | First creation time of the `id`. |
| `updated_at` | date-time | Time of this version. |
| `hlc` | string | Hybrid logical clock `wallMs:counter:nodeId`. Drives last-writer-wins merge. See 3.1. |
| `links` | string[] | Related record ids. Merged as an OR-set. |
| `sensitivity` | enum (default `public`) | `public`, `internal` or `redacted`. |
| `redactions` | array | Objects `{ span: [start, end], kind }` marking removed spans in `body`. |

### 1.2 Types

- `fact`: an objective statement about the project or the world ("the datastore is PostgreSQL 16").
- `preference`: how the user or team likes things done ("indent with tabs").
- `decision`: a choice that was made, usually with rationale, in the spirit of an ADR.
- `convention`: a rule the code is expected to follow ("API errors use `{ error: { code, message } }`").
- `episodic`: something that happened, a session episode. Recall-only by default.
- `task`: a unit of work, often carrying a `decay.ttl_at`.
- `entity`: a named thing such as a person, service, component or dataset.

`fact`, `preference`, `decision` and `convention` compile into a tool's rules files by default.
`episodic` and `task` are recall-only by default: they are retrievable through search and MCP but are
not written into always-on instruction files, because they are context rather than standing rules.

## 2. Scope and precedence

### 2.1 The four scopes

Scopes run from broadest to narrowest:

1. `global` applies to every project on this machine or account. `scope_path` is `null`. This is the
   personal or org layer.
2. `project` applies to one repository. `scope_path` is the repo root.
3. `dir` applies to a subtree of a repository. `scope_path` is a directory path and the record
   applies to that directory and everything under it.
4. `session` applies to the current working session only. Ephemeral, the most specific layer. Used
   for in-session overrides an agent should honor now but not commit as a standing rule.

**Precedence, most specific wins:** `session` > `dir` (deeper `dir` beats shallower) > `project` >
`global`. This is the answer memfold gives to the precedence gap that most tools leave undefined (P4):
the winning layer is explicit and the resolver can report which layer supplied a given value.

### 2.2 In-scope test

For a given working directory and session, a record is in scope when:

- `global`: always.
- `project`: the current repo root equals the record's `scope_path`.
- `dir`: the current working path is at or below the record's `scope_path`. A deeper `scope_path` is
  more specific and outranks a shallower one.
- `session`: the record's `provenance.session_id` equals the current session.

Only `active` records are in scope. `archived` and `tombstone` records are excluded (see 3.3).

### 2.3 How records combine

The resolver returns the set of in-scope active records, not a single winner. Records combine, they do
not wholesale-override each other. Combination has two rules:

- **Different logical settings add.** Records with different `dedup_key` values (or no `dedup_key`)
  are all kept. Ten conventions about ten things all apply at once.
- **The same logical setting shadows.** When two in-scope records share a `dedup_key`, they express
  the same setting, so only the highest-precedence one is active and the rest are shadowed. Precedence
  is the scope order in 2.1; within one scope layer the record with the greater `hlc` wins and `rev`
  breaks a remaining tie. A shadowed record is still stored, it is just not emitted.

The resolved, ordered set is what the compiler writes into each tool's files and what a search or MCP
read returns by default. The compiler emits `summary` when present and the full `body` otherwise. This
gives one edit, propagated everywhere, with a defined and inspectable winner instead of an arbitrary
one (P2, P4, P9).

## 3. Merge and sync

memfold is built to be edited on more than one machine, by more than one tool and merged without a
central lock. Identity is `id`; a version is `rev`. Two nodes that edit the same `id` produce two
`rev`s and the merge rules below reconcile them deterministically.

### 3.1 Hybrid logical clock

Every record carries an `hlc` stamp `wallMs:counter:nodeId`, zero-padded (15-digit milliseconds,
6-digit counter) so lexical order equals causal order. A node advances its clock on each local write
(`tick`), folds a remote stamp into its own state on receive (`receive`) and totally orders any two
stamps (`compareHlc`: compare `wallMs`, then `counter`, then `nodeId`). Because the order is total and
`nodeId` breaks ties, two independently produced stamps never compare equal, so merge is deterministic.

### 3.2 Field merge

- **Scalar fields last-writer-wins.** For `title`, `body`, `summary`, `type`, `scope`, `scope_path`,
  `dedup_key`, `salience`, `confidence`, `decay`, `status`, `sensitivity` and the timestamps, the value
  from the version with the greater `hlc` wins. In the common case a whole record version wins as a
  unit, because `content_hash` binds `body` to its `rev`. `hlc` is authoritative for ordering, not the
  wall-clock `updated_at`, so a machine with a skewed clock cannot silently win.
- **`tags` and `links` are OR-sets.** Each is an observed-remove set. An add records the element; a
  remove records a tombstone for that element at the removing `hlc`. Merge is the union of adds minus
  removes that causally follow the add they cancel. An element removed on one node and independently
  re-added on another (at a greater `hlc`) is present after merge. This is why tags and links can be
  edited concurrently on two tools without a lost update.

### 3.3 Deletes are tombstones

A delete MUST NOT physically drop a record. It sets `status` to `tombstone` with a fresh `hlc`. A
tombstoned record is excluded from the active set, from search and from compiled output, but it is kept
in the store and the log so the delete propagates on sync and remains auditable. `archived` is a softer
state: retained and searchable on request, but not emitted into always-on rules. This gives memory a
git-style history and a rollback story that a vector store cannot (P8).

### 3.4 Dedup

Two records are duplicates when either their `content_hash` matches (identical body) or they share a
`dedup_key` within the same scope. On dedup the store keeps one `id`, folds metadata across the
duplicates (OR-set union for `tags` and `links`, max `salience`, most recent access stats) and
supersedes or tombstones the losers, chaining `supersedes` / `superseded_by`. A stable `dedup_key` is
how re-stating a preference updates the existing record instead of piling up a near-duplicate (P11).

### 3.5 Sync

Sync is exchange and replay of the operation log (4.2). Because operations carry `hlc` and the merge
rules are deterministic, replaying two logs in any order converges to the same state. There is no
central coordinator and no lock. Two clones of a store that both made edits offline reconcile by
appending each other's log entries and re-deriving the current records.

## 4. On-disk layout

A memfold store is a directory. A repository carries a committed store for shared memory and a
machine keeps a separate uncommitted store for `global` and personal records so nothing private lands
in version control (P6, P10).

```
.memory/                      committed, project + dir + shared records
  records/<id>.md             one file per record, current version, frontmatter + body
  oplog.jsonl                 append-only operation log (the sync + audit unit)
  index.db                    SQLite mirror (FTS5 + vectors); a cache, rebuildable, gitignored
```

### 4.1 Record files

A record serializes to YAML frontmatter plus a markdown body: every field except `body` goes in the
frontmatter, `body` is the markdown that follows. The frontmatter is emitted with the YAML 1.2 core
schema, so date-time strings stay strings and are not coerced to native timestamps. The exact form
(produced by `serializeRecord`, parsed by `parseRecord`) is:

```
---
id: C6ED3NV8JGA12QKE5YKZ99E5RT
rev: 7RZ5ACTQFMMW26VHC0DJE88H5B
schema_version: 1
type: convention
scope: dir
scope_path: packages/api
dedup_key: conv:api-error-shape
content_hash: sha256:b50d9e8f...08bf2cc
hlc: "001758452700000:000001:laptop-b"
provenance:
  source: user
  tool: codex
status: active
---

All HTTP handlers under packages/api return errors as { error: { code, message } }
with an appropriate status. Never leak stack traces to clients.
```

The file name is `<id>.md`, so the path is stable across versions and the git history of one file is
the history of one memory. Serialization MUST round-trip: parsing a serialized record and re-serializing
it MUST yield an equal record. The conformance suite checks this for every valid vector.

### 4.2 The operation log

`oplog.jsonl` is append-only, one JSON object per line, each object one operation. Append-only keeps git
diffs clean (new lines only, so merges union rather than conflict) and makes the log the natural unit of
sync and audit. Each entry carries at least an operation, the record id and revision it concerns, the
`hlc` and a wall-clock time:

```
{"op":"put","id":"C6ED3NV8...","rev":"7RZ5ACTQ...","hlc":"001758452700000:000001:laptop-b","at":"2026-09-21T11:45:00Z","actor":"user"}
{"op":"tag_add","id":"C6ED3NV8...","el":"http","hlc":"001758452700100:000000:laptop-b","at":"2026-09-21T11:45:12Z"}
{"op":"tombstone","id":"A9VDJ7KK...","rev":"...","hlc":"001758539000000:000000:laptop-a","at":"2026-09-22T09:00:00Z"}
```

Operations are `put` (create or new version), `tombstone`, `archive`, `tag_add`, `tag_remove`,
`link_add` and `link_remove`. The current record files are a materialized view of the log: an
implementation MAY rebuild `records/` and `index.db` from `oplog.jsonl` alone.

### 4.3 The SQLite mirror

`index.db` mirrors records into SQLite with an FTS5 full-text index and a `sqlite-vec` vector index for
hybrid retrieval. It is a derived cache. It MUST be rebuildable from the record files and log. It MUST
NOT be the source of truth. Storing it in the repo is optional and it SHOULD be gitignored.

## 5. The secret gate

Rules and memory files are meant to be committed and shared, which makes them exactly the wrong place
for a credential, yet agents write config there and do leak keys (P6). memfold makes keeping secrets out
structural rather than advisory.

**Requirement (MUST).** No record file, no operation-log entry and no compiled tool file may be written
while it contains a detected secret. A write that would do so MUST be refused. The reference store
raises `SecretLeakError` and writes nothing.

**Detection.** Every write runs a fast prefilter (`scanSecrets`) over the serialized content: named
patterns for AWS access key ids, GitHub tokens, OpenAI-style keys, Slack tokens, Google API keys, PEM
private-key blocks and JWTs, plus a Shannon-entropy check that flags long high-entropy tokens the named
patterns miss. A deeper scanner such as `gitleaks` or `secretlint` MAY be layered on as an opt-in pass.
The gate is allowed false positives by design: refusing to write is safe, leaking is not.

**On a hit.** The write is blocked and the findings are reported by `kind` with the matched value
masked (never echoed in full). To proceed, the author removes the secret or redacts it. Redaction
records the removed span in `redactions` and sets `sensitivity` to `redacted`. A value that must be
kept is routed to the machine-local store that is never committed. A masked or redacted record passes
the gate.

**The compiler re-checks.** Because a compiled `CLAUDE.md`, `AGENTS.md` or `.cursor/rules` file is
generated from records that already passed the gate, it is secret-free by construction, but the compiler
MUST run the gate again before touching disk, so a bug in composition cannot write a secret into a file
a tool will commit.

**Ingested content is untrusted.** When importing a foreign rules file, an implementation SHOULD strip
zero-width and other invisible Unicode before storing it, because instruction files are an active
injection surface (P13). The secret gate protects secrets leaving; Unicode sanitising protects malicious
instructions entering.

---

SPDX-License-Identifier: Apache-2.0
