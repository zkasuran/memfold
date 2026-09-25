<!-- SPDX-License-Identifier: Apache-2.0 -->

# memfold (Rust SDK)

A thin, blocking Rust client for the [memfold](../../README.md) daemon REST API.

memfold is one common memory for every AI coding tool and agent framework. It stores each durable
fact, preference, decision or note once, as a Memory Record, and projects that record into whatever
native format each tool reads. This crate talks to a running memfold daemon over HTTP so scripts,
editors and agent frameworks can read and write that shared memory.

The client is built on [`ureq`](https://crates.io/crates/ureq) (small, blocking HTTP) and
[`serde`](https://crates.io/crates/serde). No async runtime is pulled in.

## Install

```toml
[dependencies]
memfold = "0.1"
```

## Quick start

```rust
use memfold::{Client, AddInput, SearchInput, ListInput, Provenance};

fn main() -> Result<(), memfold::MemfoldError> {
    // Base URL, plus an optional bearer token.
    let client = Client::new("http://127.0.0.1:7777").with_token("my-token");

    // Is the daemon up? Is vector search on? How many records?
    let health = client.health()?;
    println!("status={} vector={} count={}", health.status, health.vector_enabled, health.count);

    // Write a record.
    let record = client.add(
        AddInput::new(
            "fact",
            "project",
            "The datastore is PostgreSQL 16.",
            Provenance::new("agent"),
        )
        .scope_path("/path/to/repo")
        .title("Datastore")
        .tags(["db", "infra"])
        .salience(0.8),
    )?;
    println!("stored {} (rev {})", record.id, record.rev);

    // Search.
    for hit in client.search(SearchInput::new("what database do we use").limit(5))? {
        println!("{:.3} via {:?}: {}", hit.score, hit.via, hit.record.body);
    }

    // Fetch by id (None on a 404).
    if let Some(found) = client.get(&record.id)? {
        println!("got {}", found.id);
    }

    // List with optional filters.
    let conventions = client.list(ListInput::default().scope("project").r#type("convention"))?;
    println!("{} conventions in scope", conventions.len());

    // Forget (tombstone) a record.
    client.forget(&record.id)?;

    Ok(())
}
```

## API

`Client::new(base_url)` builds a client; `.with_token(token)` attaches a bearer token sent as
`Authorization: Bearer <token>` on every request. A trailing slash on the base URL is trimmed.

| Method | HTTP | Returns |
|---|---|---|
| `health()` | `GET /health` | `Health { status, vector_enabled, count }` |
| `add(AddInput)` | `POST /memories` | the created `MemoryRecord` (201) |
| `search(SearchInput)` | `POST /search` | `Vec<SearchHit>` `{ record, score, via }` |
| `get(id)` | `GET /memories/{id}` | `Option<MemoryRecord>` (`None` on 404) |
| `list(ListInput)` | `GET /memories?scope=&type=&status=` | `Vec<MemoryRecord>` |
| `forget(id)` | `DELETE /memories/{id}` | `()` (204) |

Input structs (`AddInput`, `SearchInput`, `ListInput`) have builder-style setters, and every optional
field is omitted from the request when unset. `MemoryRecord` follows
[`spec/memory-record.schema.json`](../../spec/memory-record.schema.json): unknown fields are ignored
and omitted optional fields are defaulted on parse, so a newer daemon does not break an older client.

## Errors

Every method returns `Result<_, MemfoldError>`:

- `MemfoldError::Http(String)` — transport failure (DNS, connection, TLS, timeout).
- `MemfoldError::Api { status }` — the daemon answered with a non-success HTTP status. `get()` handles
  404 for you by returning `Ok(None)` instead.
- `MemfoldError::Parse(String)` — the response body was not the expected JSON.

## Testing

Integration tests in `tests/client.rs` stub the daemon with a local
[`mockito`](https://crates.io/crates/mockito) server, so they need no live network beyond localhost.

```sh
cargo test
```

## Licence

Apache-2.0. See [`LICENSE`](../../LICENSE).
