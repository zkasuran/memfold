// SPDX-License-Identifier: Apache-2.0

import type { MemoryRecord, MemoryType, Scope } from '@memfold/core'
import { type MemfoldLike, findActiveByDedup } from '../common'

/**
 * A stored record in the LangGraph `BaseStore` shape (JS/TS): a namespaced, keyed JSON value with
 * timestamps. See research/08-framework-memory.md.
 */
export interface StoreItem<V = Record<string, unknown>> {
  namespace: string[]
  key: string
  value: V
  createdAt: Date
  updatedAt: Date
}

/** A search result. `SearchItem` in LangGraph terms: an `Item` plus a relevance `score`. */
export interface StoreSearchItem<V = Record<string, unknown>> extends StoreItem<V> {
  score: number | null
}

export interface MemfoldLangGraphStoreOptions {
  /** memfold scope every item is written under. Default `'project'`. */
  scope?: Scope
  /** memfold record type used for items. Default `'fact'`. */
  type?: MemoryType
}

export interface LangGraphSearchOptions {
  query?: string
  limit?: number
}

const SEP = '/'

/**
 * A LangGraph-JS `BaseStore`-shaped adapter backed by memfold. It matches the documented interface
 * (`put` / `get` / `search` / `delete` over `namespace: string[]` + `key`) without importing
 * langchain, so it stays version-agnostic. The hierarchical namespace maps to a memfold
 * `scope_path`, and `namespace + key` becomes the record `dedup_key` (the logical primary key).
 * The value is stored as the JSON body.
 */
export class MemfoldLangGraphStore<V extends Record<string, unknown> = Record<string, unknown>> {
  private readonly scope: Scope
  private readonly type: MemoryType

  constructor(
    private readonly backend: MemfoldLike,
    opts: MemfoldLangGraphStoreOptions = {},
  ) {
    this.scope = opts.scope ?? 'project'
    this.type = opts.type ?? 'fact'
  }

  private nsPath(namespace: string[]): string {
    return namespace.join(SEP)
  }

  private dedupOf(namespace: string[], key: string): string {
    return namespace.length ? `${namespace.join(SEP)}${SEP}${key}` : key
  }

  private toItem(rec: MemoryRecord): StoreItem<V> {
    const namespace = rec.scope_path ? rec.scope_path.split(SEP) : []
    const key =
      rec.scope_path && rec.dedup_key
        ? rec.dedup_key.slice(rec.scope_path.length + SEP.length)
        : (rec.dedup_key ?? '')
    return {
      namespace,
      key,
      value: JSON.parse(rec.body) as V,
      createdAt: new Date(rec.created_at),
      updatedAt: new Date(rec.updated_at),
    }
  }

  private hasPrefix(rec: MemoryRecord, prefix: string[]): boolean {
    const ns = rec.scope_path ? rec.scope_path.split(SEP) : []
    return prefix.every((seg, i) => ns[i] === seg)
  }

  /** Upsert a value at `namespace` / `key`. A prior value at the same address is replaced. */
  async put(namespace: string[], key: string, value: V): Promise<void> {
    const dedup = this.dedupOf(namespace, key)
    const existing = await findActiveByDedup(this.backend, dedup, this.scope)
    if (existing) await this.backend.forget(existing.id)
    await this.backend.add({
      type: this.type,
      scope: this.scope,
      scope_path: this.nsPath(namespace) || null,
      dedup_key: dedup,
      body: JSON.stringify(value),
      provenance: { source: 'agent' },
    })
  }

  async get(namespace: string[], key: string): Promise<StoreItem<V> | null> {
    const rec = await findActiveByDedup(this.backend, this.dedupOf(namespace, key), this.scope)
    return rec ? this.toItem(rec) : null
  }

  async delete(namespace: string[], key: string): Promise<void> {
    const rec = await findActiveByDedup(this.backend, this.dedupOf(namespace, key), this.scope)
    if (rec) await this.backend.forget(rec.id)
  }

  /**
   * Items under `namespacePrefix`. With a `query`, results are ranked by memfold hybrid search;
   * without one, the newest items are returned and `score` is null.
   */
  async search(
    namespacePrefix: string[],
    opts: LangGraphSearchOptions = {},
  ): Promise<StoreSearchItem<V>[]> {
    const limit = opts.limit ?? 10
    if (opts.query) {
      const hits = await this.backend.search(opts.query, {
        scope: this.scope,
        types: [this.type],
        limit: limit * 4,
      })
      return hits
        .filter((h) => this.hasPrefix(h.record, namespacePrefix))
        .slice(0, limit)
        .map((h) => ({ ...this.toItem(h.record), score: h.score }))
    }
    const rows = await this.backend.list({ scope: this.scope, type: this.type, status: 'active' })
    return rows
      .filter((r) => this.hasPrefix(r, namespacePrefix))
      .slice(0, limit)
      .map((r) => ({ ...this.toItem(r), score: null }))
  }
}
