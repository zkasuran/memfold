// SPDX-License-Identifier: Apache-2.0

import type { MemoryRecord, SearchHit, SearchOptions } from '@memfold/core'
import { type AddInput, type ListOptions, type MemfoldLike, toNewRecordInput } from './common'

export interface MemfoldClientOptions {
  /** Base URL of the memfold daemon, e.g. `http://127.0.0.1:7777`. */
  baseUrl: string
  /** Optional bearer token, sent as `Authorization: Bearer <token>`. */
  token?: string
  /** Override the fetch implementation. Defaults to the global `fetch` resolved at call time. */
  fetch?: typeof fetch
}

/** Thrown on any non-2xx daemon response. Carries the status and the raw response body. */
export class MemfoldHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly method: string,
    readonly url: string,
    readonly body: string,
  ) {
    super(`memfold: ${method} ${url} -> ${status} ${statusText}`)
    this.name = 'MemfoldHttpError'
  }
}

/**
 * Remote memory over the memfold daemon REST API. Same surface as the in-process `Memfold`, so a
 * consumer swaps one for the other without touching call sites. Uses the global `fetch`.
 */
export class MemfoldClient implements MemfoldLike {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly fetchImpl?: typeof fetch

  constructor(opts: MemfoldClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.token = opts.token
    this.fetchImpl = opts.fetch
  }

  private headers(hasBody: boolean): Record<string, string> {
    const h: Record<string, string> = {}
    if (hasBody) h['content-type'] = 'application/json'
    if (this.token) h.authorization = `Bearer ${this.token}`
    return h
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const f = this.fetchImpl ?? globalThis.fetch
    const res = await f(url, {
      method,
      headers: this.headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new MemfoldHttpError(res.status, res.statusText, method, url, text)
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** GET /health. Returns whatever the daemon reports (shape is daemon-defined). */
  health(): Promise<unknown> {
    return this.call<unknown>('GET', '/health')
  }

  add(input: AddInput): Promise<MemoryRecord> {
    return this.call<MemoryRecord>('POST', '/memories', toNewRecordInput(input))
  }

  search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    return this.call<SearchHit[]>('POST', '/search', {
      query,
      limit: opts.limit,
      scope: opts.scope,
      types: opts.types,
    })
  }

  async get(id: string): Promise<MemoryRecord | null> {
    try {
      return await this.call<MemoryRecord>('GET', `/memories/${encodeURIComponent(id)}`)
    } catch (e) {
      if (e instanceof MemfoldHttpError && e.status === 404) return null
      throw e
    }
  }

  async list(opts: ListOptions = {}): Promise<MemoryRecord[]> {
    const params = new URLSearchParams()
    if (opts.scope) params.set('scope', opts.scope)
    if (opts.type) params.set('type', opts.type)
    const qs = params.toString()
    let rows = await this.call<MemoryRecord[]>('GET', `/memories${qs ? `?${qs}` : ''}`)
    // The daemon list route filters on scope + type only; apply the rest here so `list` behaves
    // the same as the in-process store.
    if (opts.scopePath) rows = rows.filter((r) => r.scope_path === opts.scopePath)
    if (opts.status) rows = rows.filter((r) => r.status === opts.status)
    return rows
  }

  async forget(id: string): Promise<void> {
    await this.call<unknown>('DELETE', `/memories/${encodeURIComponent(id)}`)
  }

  /** PATCH /memories/:id. Remote-only: partial update of an existing record. */
  update(id: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord> {
    return this.call<MemoryRecord>('PATCH', `/memories/${encodeURIComponent(id)}`, patch)
  }

  /** No-op. The client holds no local resources; present so it satisfies the shared surface. */
  async close(): Promise<void> {}
}
