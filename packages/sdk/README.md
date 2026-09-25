<!-- SPDX-License-Identifier: Apache-2.0 -->

# @memfold/sdk

The memfold TypeScript SDK. Use one memory surface two ways: embed the store in your process, or
talk to a memfold daemon over HTTP. The method names are the same either way (`add`, `search`,
`get`, `list`, `forget`, `close`), so you can start embedded and move to the daemon later without
touching call sites. Ships drop-in adapters for LangGraph-JS and the Vercel AI SDK.

Requires Node 22 or newer (the remote client uses the global `fetch`).

## Install

```sh
pnpm add @memfold/sdk
```

## Embedded

`Memfold` wraps a local SQLite store with keyword (FTS5) and optional vector search.

```ts
import { Memfold } from '@memfold/sdk'

const mem = new Memfold('./memory.db') // omit the path for an in-memory store

const rec = await mem.add({
  type: 'preference',
  scope: 'global',
  body: 'The user prefers dark mode in the editor',
})

const hits = await mem.search('dark mode')
console.log(hits[0]?.record.body)

await mem.forget(rec.id) // tombstone; history is preserved
await mem.close()
```

`add` takes a `NewRecordInput` with `provenance` optional (it defaults to `{ source: 'agent' }`).
Constructor options pass through to the core store, so you can supply a custom `embedder` or set
`novec: true` for keyword-only retrieval.

## Remote

`MemfoldClient` speaks the daemon REST API and mirrors the embedded surface.

```ts
import { MemfoldClient } from '@memfold/sdk'

const mem = new MemfoldClient({ baseUrl: 'http://127.0.0.1:7777', token: 'optional-bearer' })

await mem.add({ type: 'fact', scope: 'project', body: 'The build runs on Node 22' })
const hits = await mem.search('node version', { limit: 5 })
```

A non-2xx response throws `MemfoldHttpError` carrying the status and the raw body. `get` returns
`null` on a 404 rather than throwing. The client also exposes `health()` and a remote-only
`update(id, patch)`.

## LangGraph store adapter

`MemfoldLangGraphStore` matches the LangGraph-JS `BaseStore` shape (`put` / `get` / `search` /
`delete` over a `string[]` namespace plus a key). It does not import langchain, so it stays
version-agnostic. The namespace maps to a memfold `scope_path`, `namespace + key` becomes the
record `dedup_key`, and the value is stored as JSON.

```ts
import { Memfold, MemfoldLangGraphStore } from '@memfold/sdk'

const store = new MemfoldLangGraphStore(new Memfold())

await store.put(['users', 'u1'], 'profile', { name: 'Ada', likes: 'compilers' })
const item = await store.get(['users', 'u1'], 'profile')
const found = await store.search(['users'], { query: 'compilers', limit: 10 })
await store.delete(['users', 'u1'], 'profile')
```

`put` upserts: a second write to the same namespace and key replaces the first. Items are returned
in the documented `Item` shape (`namespace`, `key`, `value`, `createdAt`, `updatedAt`), and search
results add a `score`. The backend can be a `Memfold` or a `MemfoldClient`.

## Vercel AI SDK message persistence

`MemfoldChatStore` persists chat messages as an episodic record keyed by a thread id, which is the
`loadChat` / `saveChat` snapshot pattern the AI SDK documents.

```ts
import { Memfold, MemfoldChatStore } from '@memfold/sdk'

const chat = new MemfoldChatStore(new Memfold())

// on a stream-completion callback (onFinish in v5, onEnd in current docs):
await chat.saveMessages(threadId, messages)

// when a request comes in:
const messages = await chat.loadMessages(threadId)
```

`loadChat(id)` and `saveChat({ chatId, messages })` are provided as aliases matching the AI SDK
names. The message type is generic, so any shape works without importing the `ai` package.

## Exports

`Memfold`, `MemfoldClient`, `MemfoldHttpError`, `MemfoldLangGraphStore`, `MemfoldChatStore`,
`createMemfoldChatStore`, the `MemfoldLike` shared interface, and the core `MemoryRecord`,
`SearchHit`, `SearchOptions`, `MemoryType`, `Scope` and `NewRecordInput` types.

## License

Apache-2.0.
