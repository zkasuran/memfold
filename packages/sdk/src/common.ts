// SPDX-License-Identifier: Apache-2.0

import type {
  AllOptions,
  MemoryRecord,
  NewRecordInput,
  Provenance,
  Scope,
  SearchHit,
  SearchOptions,
} from '@memfold/core'

/**
 * Ergonomic input for `add`. Same as core's `NewRecordInput` but `provenance` is optional:
 * callers that do not care about lineage get a sensible default.
 */
export type AddInput = Omit<NewRecordInput, 'provenance'> & { provenance?: Provenance }

/** Filter for `list`. Mirrors core's `AllOptions`. */
export type ListOptions = AllOptions

/**
 * The method surface shared by the in-process `Memfold` and the remote `MemfoldClient`.
 * Framework adapters accept anything shaped like this, so they work embedded or over the daemon.
 */
export interface MemfoldLike {
  add(input: AddInput): Promise<MemoryRecord>
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>
  get(id: string): Promise<MemoryRecord | null>
  list(opts?: ListOptions): Promise<MemoryRecord[]>
  forget(id: string): Promise<void>
  close(): Promise<void>
}

/** Default lineage stamped on records written without an explicit provenance. */
export const DEFAULT_PROVENANCE: Provenance = { source: 'agent' }

/** Fill in the default provenance so `AddInput` becomes a full `NewRecordInput`. */
export function toNewRecordInput(input: AddInput): NewRecordInput {
  return { ...input, provenance: input.provenance ?? DEFAULT_PROVENANCE }
}

/**
 * Find the single active record carrying `dedupKey` within `scope`. Framework adapters use a
 * dedup key as their logical primary key, so this is how they resolve a namespace+key back to a
 * record over the shared surface (works identically embedded or remote).
 */
export async function findActiveByDedup(
  backend: MemfoldLike,
  dedupKey: string,
  scope?: Scope,
): Promise<MemoryRecord | null> {
  const rows = await backend.list({ scope, status: 'active' })
  return rows.find((r) => r.dedup_key === dedupKey) ?? null
}
