# FAQ

## Is memfold open source?

No, it is **source-available**. The specification, the conformance suite and the `@memfold/core`,
`@memfold/adapters`, `@memfold/mcp` and `@memfold/sdk` packages are Apache-2.0, so you can implement
the protocol and build clients freely. The `@memfold/daemon` package and the `memfold` CLI are
FSL-1.1-ALv2: any use is permitted except a Competing Use, and each release converts to Apache-2.0 two
years after it ships. FSL is not an OSI-approved license, so memfold is described as source-available,
not "open source".

## How does it relate to AGENTS.md and MCP?

It feeds both. `AGENTS.md` is one of the compile targets, written as a managed block so your
hand-authored guidance stays intact. MCP is a first-class serving surface, built tools-first so
tool-only clients keep the full read and write surface. memfold is the single source those two are
generated from, which is the piece neither provides on its own.

## Which file wins when several rules apply?

memfold defines precedence explicitly, most specific wins: `session` beats `dir`, a deeper `dir` beats
a shallower one, `dir` beats `project` and `project` beats `global`. Records with different logical
settings all apply at once. Two records that share a `dedup_key` express the same setting, so the
highest-precedence one is active and the rest are shadowed but still stored. The resolver can report
which layer supplied a value, so you are never guessing which file won. See
[Concepts](concepts.md#scopes-and-precedence).

## What stops a secret from being committed into a rules file?

A pre-write gate. Every write runs a fast prefilter over the serialized content, with named patterns
for common keys and tokens plus an entropy check for long high-entropy strings. A hit raises
`SecretLeakError` and nothing is written. The compiler runs the same scan again before it writes any
tool file, so a bug in composition cannot slip a secret into a committed file. The gate accepts false
positives on purpose, because refusing to write is safe and leaking is not. See
[Concepts](concepts.md#the-secret-gate).

## Can I edit records by hand?

Yes. Records serialize to YAML frontmatter plus a markdown body, one file per record, so they are
git-diffable and human-editable. Serialization round-trips: parsing a record and re-serializing it
yields an equal record, and the conformance suite checks this for every valid vector. The SQLite index
is a rebuildable cache, not the source of truth.

## Does memory follow me across machines and tools?

Yes. The store is portable, and merge is deterministic. Every record carries a hybrid logical clock
stamp, scalar fields are last-writer-wins by that clock, and tags and links are OR-sets, so two clones
edited offline reconcile by replaying each other's op-logs in any order and converge to the same
state. There is no central coordinator and no lock.

## Can I roll back a bad memory?

Yes. Deletes are tombstones, not physical drops, and every version is a new `rev` that chains
`supersedes`. The op-log is append-only, so the history of a memory is the history of its file under
git. That is the audit trail and rollback a vector store cannot give.

## Does it need an embedding model or an API key?

No. The default embedder is offline and dependency-free, so the store works without any model or key.
It gives keyword search plus a stable, non-semantic vector leg. For semantic search, install a local
transformer model and pass it as the embedder, or set `novec: true` for keyword-only retrieval. If
`sqlite-vec` cannot load, the store falls back to keyword search automatically.

## What are episodic and task records for, and why do they not show up in my rules files?

`episodic` records are things that happened and `task` records are units of work. Both are recall-only
by default: retrievable through search and MCP, but not written into always-on instruction files,
because they are context rather than standing rules. `fact`, `preference`, `decision` and `convention`
are the types that compile into rules files.

## Is the daemon safe to run?

It binds to loopback and is unauthenticated unless `MEMFOLD_TOKEN` is set. Without a token, anyone who
can reach the port has full read and write access. Set a token before you bind to a non-loopback host
or expose the port, and terminate TLS in front of it. The startup log line states which mode it is in.
See [Daemon REST](daemon-rest.md#security-posture).

## What is built today?

The TypeScript packages `@memfold/core`, `@memfold/adapters`, `@memfold/mcp`, `@memfold/daemon` and
`@memfold/sdk`, with a passing test suite. The `memfold` CLI and the Python, Go and Rust clients are in
progress. The [CLI](cli.md) page documents the planned command surface and shows the surface that runs
today for each command.
