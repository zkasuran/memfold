// SPDX-License-Identifier: Apache-2.0

import {
  type HlcState,
  type MemoryRecord,
  type SearchHit,
  type SearchOptions,
  SqliteStore,
  type SqliteStoreOptions,
  makeHlcState,
  newNodeId,
  newRecord,
  tick,
} from '@memfold/core'
import { type AddInput, type ListOptions, type MemfoldLike, toNewRecordInput } from './common'

export interface MemfoldOptions extends SqliteStoreOptions {
  /** Node id baked into HLC stamps. Defaults to a random per-instance id. */
  nodeId?: string
}

/**
 * In-process memory. Wraps a local SQLite store (FTS5 + optional vector search) behind a small,
 * typed surface: `add`, `search`, `get`, `list`, `forget`, `close`. One HLC clock per instance
 * stamps every write so records merge deterministically with records from other machines.
 */
export class Memfold implements MemfoldLike {
  private readonly store: SqliteStore
  private readonly hlc: HlcState

  constructor(path = ':memory:', opts: MemfoldOptions = {}) {
    this.store = new SqliteStore(path, opts)
    this.hlc = makeHlcState(opts.nodeId ?? newNodeId())
  }

  /** True when the vector search leg loaded. False falls back to keyword-only retrieval. */
  get vectorEnabled(): boolean {
    return this.store.vectorEnabled
  }

  /** Write a new record and return it as stored (with embedding metadata filled in). */
  async add(input: AddInput): Promise<MemoryRecord> {
    const rec = newRecord(toNewRecordInput(input), this.hlc)
    await this.store.upsert(rec)
    return (await this.store.get(rec.id)) ?? rec
  }

  search(query: string, opts?: SearchOptions): Promise<SearchHit[]> {
    return this.store.search(query, opts)
  }

  get(id: string): Promise<MemoryRecord | null> {
    return this.store.get(id)
  }

  list(opts?: ListOptions): Promise<MemoryRecord[]> {
    return this.store.all(opts)
  }

  /** Tombstone a record. It stops matching reads and search while its history is preserved. */
  async forget(id: string): Promise<void> {
    await this.store.tombstone(id, tick(this.hlc))
  }

  close(): Promise<void> {
    return this.store.close()
  }
}
