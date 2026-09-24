import type { MemoryRecord, MemoryType, Scope } from './record'

export interface SearchHit {
  record: MemoryRecord
  score: number
  via: Array<'fts' | 'vec'>
}

export interface SearchOptions {
  limit?: number
  scope?: Scope
  scopePath?: string
  types?: MemoryType[]
  includeArchived?: boolean
  /** Per-leg candidate pool size before fusion (default 50). */
  candidateK?: number
}

export interface AllOptions {
  scope?: Scope
  scopePath?: string
  status?: MemoryRecord['status']
  type?: MemoryType
}

/** The universal store contract. SDK framework adapters (LangGraph BaseStore, LlamaIndex,
 *  CrewAI, ADK MemoryService, …) all map onto this surface. */
export interface MemoryStore {
  upsert(rec: MemoryRecord): Promise<void>
  get(id: string): Promise<MemoryRecord | null>
  all(opts?: AllOptions): Promise<MemoryRecord[]>
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>
  tombstone(id: string, hlc: string): Promise<void>
  count(): Promise<number>
  close(): Promise<void>
}
