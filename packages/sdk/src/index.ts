// SPDX-License-Identifier: Apache-2.0

// Embedded, in-process memory.
export { Memfold } from './embedded'
export type { MemfoldOptions } from './embedded'

// Remote memory over the daemon REST API.
export { MemfoldClient, MemfoldHttpError } from './client'
export type { MemfoldClientOptions } from './client'

// Shared surface + input types.
export { DEFAULT_PROVENANCE, findActiveByDedup, toNewRecordInput } from './common'
export type { AddInput, ListOptions, MemfoldLike } from './common'

// Framework adapters.
export { MemfoldLangGraphStore } from './frameworks/langgraph-store'
export type {
  LangGraphSearchOptions,
  MemfoldLangGraphStoreOptions,
  StoreItem,
  StoreSearchItem,
} from './frameworks/langgraph-store'
export { MemfoldChatStore, createMemfoldChatStore } from './frameworks/vercel-ai'
export type { MemfoldChatStoreOptions } from './frameworks/vercel-ai'

// Re-exported core types so consumers need not depend on @memfold/core directly.
export type {
  MemoryRecord,
  MemoryType,
  NewRecordInput,
  Provenance,
  Scope,
  SearchHit,
  SearchOptions,
} from '@memfold/core'
