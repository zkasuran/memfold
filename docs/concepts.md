# Concepts

memfold has one central data type and a small set of rules for scoping it, merging it, ranking it and
keeping secrets out of it. This page explains each. The normative version is
[`../spec/protocol.md`](../spec/protocol.md); this is the working explanation.

## The Memory Record

A Memory Record is one durable item of memory. It has a stable identity, a type, a scope, a body and
the metadata needed to rank it, merge it, trace it and redact it. The full field list is in
[`../spec/memory-record.schema.json`](../spec/memory-record.schema.json). The fields you touch most:

| Field | Meaning |
|---|---|
| `id` | Stable identity across every version. A ULID, assigned once. |
| `rev` | This version's id. A new edit produces a new `rev` under the same `id`. |
| `type` | `fact`, `preference`, `decision`, `convention`, `episodic`, `task` or `entity`. |
| `scope` | `global`, `project`, `dir` or `session`. |
| `scope_path` | The repo or directory the scope binds to. `null` for `global`. |
| `body` | Markdown content. This is what search indexes and the compiler emits. |
| `summary` | A one-line form emitted into rules files when the body is long. |
| `tags` | Free-form labels, merged as an OR-set. |
| `dedup_key` | A normalized natural key for "the same logical setting", such as `pref:indent-style`. |
| `salience` | Importance weight for ranking, 0 to 1. |
| `confidence` | Trust that the fact is correct, 0 to 1. |
| `decay` | Half-life, hard expiry and a `pinned` flag. |
| `provenance` | Who or what wrote it and from where. |
| `hlc` | Hybrid logical clock stamp that drives merge. |
| `status` | `active`, `archived` or `tombstone`. |

### Types

- `fact`: an objective statement about the project or the world.
- `preference`: how the user or team likes things done.
- `decision`: a choice that was made, usually with rationale.
- `convention`: a rule the code is expected to follow.
- `episodic`: something that happened, a session episode. Recall-only by default.
- `task`: a unit of work, often carrying a hard expiry.
- `entity`: a named thing, a person, service, component or dataset.

`fact`, `preference`, `decision` and `convention` compile into a tool's rules files by default.
`episodic` and `task` are recall-only: retrievable through search and MCP but not written into
always-on files, because they are context rather than standing rules.

## Scopes and precedence

Scopes run from broadest to narrowest:

1. `global`. Every project on this machine or account. The personal or org layer. `scope_path` is
   `null`.
2. `project`. One repository. `scope_path` is the repo root.
3. `dir`. A subtree of a repository, applying to that directory and everything under it.
4. `session`. The current working session only. Ephemeral, the most specific layer.

**Precedence, most specific wins:** `session` beats `dir`, a deeper `dir` beats a shallower one,
`dir` beats `project` and `project` beats `global`. This is memfold's answer to the precedence gap
most tools leave undefined: the winning layer is explicit and the resolver can report which layer
supplied a given value.

### How records combine

The resolver returns the set of in-scope active records, not one winner. Records combine rather than
wholesale-override each other, by two rules:

- **Different logical settings add.** Records with different `dedup_key` values or no `dedup_key`
  are all kept. Ten conventions about ten things all apply at once.
- **The same logical setting shadows.** When two in-scope records share a `dedup_key`, they express
  the same setting, so only the highest-precedence one is active and the rest are shadowed. Within one
  scope layer the record with the greater `hlc` wins, and `rev` breaks a remaining tie. A shadowed
  record is still stored, it is just not emitted.

That gives one edit propagated everywhere, with a defined and inspectable winner instead of an
arbitrary one.

## HLC merge

memfold is built to be edited on more than one machine, by more than one tool, and merged without a
central lock. Identity is `id`, a version is `rev`. Two nodes that edit the same `id` produce two
`rev`s, reconciled deterministically.

- Every record carries a **hybrid logical clock** stamp `wallMs:counter:nodeId`, zero-padded so
  lexical order equals causal order. A node advances its clock on each local write, folds a remote
  stamp in on receive and totally orders any two stamps. Because `nodeId` breaks ties, two
  independent stamps never compare equal, so merge is deterministic.
- **Scalar fields are last-writer-wins** by `hlc`, not by wall-clock time, so a machine with a skewed
  clock cannot silently win.
- **`tags` and `links` are OR-sets.** An element removed on one node and independently re-added on
  another survives the merge, so two tools can edit tags concurrently without a lost update.
- **Deletes are tombstones.** A delete sets `status` to `tombstone` with a fresh `hlc`. The record is
  excluded from the active set, search and compiled output but kept in the store and the log, so the
  delete propagates on sync and stays auditable. This is the git-style history and rollback a vector
  store cannot give.

Sync is exchange and replay of the operation log. Because operations carry `hlc` and the rules are
deterministic, replaying two logs in any order converges to the same state.

## Salience and decay

Retrieval blends four signals: the fused search score, importance (`salience`), recency and
`confidence`. Recency comes from `decay`:

- `half_life_days` sets how fast a record's recency weight halves. A record with no half-life does not
  decay.
- `ttl_at` is a hard expiry.
- `pinned` opts a record out of decay and out of consolidation pruning.

Decay lets old, unreferenced episodes fade in ranking while pinned conventions stay at full weight.

## Dedup and consolidation

Two records are duplicates when their `content_hash` matches (identical body) or they share a
`dedup_key` within the same scope. On dedup the store keeps one `id`, folds metadata across the copies
(OR-set union for tags and links, max salience, most recent access stats) and supersedes or tombstones
the losers. A stable `dedup_key` is how re-stating a preference updates the existing record instead of
piling up a near-duplicate.

## The secret gate

Rules and memory files are meant to be committed and shared, which makes them the wrong place for a
credential, yet agents write config there and leak keys. memfold makes keeping secrets out structural
rather than advisory.

- **No write may contain a detected secret.** Every write runs a fast prefilter over the serialized
  content: named patterns for AWS keys, GitHub tokens, OpenAI-style keys, Slack tokens, Google API
  keys, PEM private-key blocks and JWTs, plus a Shannon-entropy check for long high-entropy tokens the
  named patterns miss. A hit raises `SecretLeakError` and nothing is written.
- **The gate is allowed false positives by design.** Refusing to write is safe. Leaking is not.
- **On a hit** the findings are reported by kind with the value masked, never echoed in full. To
  proceed, remove the secret, record the removed span in `redactions` and set `sensitivity` to
  `redacted`, or route the value to the machine-local store that is never committed.
- **The compiler re-checks.** A compiled `CLAUDE.md` or `.cursor/rules` file is generated from records
  that already passed the gate, but the compiler runs the scan again before touching disk, so a bug in
  composition cannot write a secret into a file a tool will commit.
- **Ingested content is untrusted.** When importing a foreign rules file, an implementation should
  strip zero-width and other invisible Unicode before storing it, because instruction files are an
  active injection surface. The gate protects secrets leaving; Unicode sanitising protects malicious
  instructions entering.
